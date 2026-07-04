import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie, uniqueIsbnPrefix } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(response.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("Impression et fabrication (Lot 3)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let genreId: string;
  let printerId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const genre = await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } });
    genreId = genre.id;
    await createUserWithRole("resp_impression_printing_test", "RESP_IMPRESSION", "RespImpression123!");

    const partner = await prisma.partner.create({ data: { category: "imprimeur", firstName: "Presses", lastName: "du Littoral" } });
    const printerResponse = await app.inject({
      method: "POST",
      url: "/api/v1/printers",
      headers: { cookie: adminCookie },
      payload: { partner_id: partner.id, specialties: ["offset"], payment_terms: "30 jours" },
    });
    printerId = printerResponse.json().id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // Assemble un manuscrit avec un BAT signé, condition d'entrée du module Impression (Ch. 15 §15.1).
  async function createManuscriptWithSignedBat(title: string) {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: {
        title,
        genre_id: genreId,
        language: "fr",
        owner_id: adminId,
        author: { first_name: "Auteur", last_name: title },
      },
    });
    const manuscript = createResponse.json();

    const partnerId = (await prisma.workContributor.findFirstOrThrow({ where: { manuscriptId: manuscript.id } })).partnerId;
    const contractResponse = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { cookie: adminCookie },
      payload: { type: "edition", manuscript_id: manuscript.id, partner_id: partnerId, financial_terms: {} },
    });
    const contract = contractResponse.json();
    for (const status of ["legal_review", "direction_approval", "awaiting_signature", "active"]) {
      await app.inject({
        method: "PATCH",
        url: `/api/v1/contracts/${contract.id}/status`,
        headers: { cookie: adminCookie },
        payload: { status },
      });
    }

    const pool = await app.inject({
      method: "POST",
      url: "/api/v1/isbn-pools",
      headers: { cookie: adminCookie },
      payload: { prefix: uniqueIsbnPrefix(1), digit_width: 1, range_start: 0, range_end: 9 },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/isbn`,
      headers: { cookie: adminCookie },
      payload: { format: "print", pool_id: pool.json().id },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/legal-deposits`,
      headers: { cookie: adminCookie },
      payload: { country: "France", depository: "BnF", copies_required: 2 },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/metadata`,
      headers: { cookie: adminCookie },
      payload: { summary: "Résumé complet", weight_grams: 350, thema_codes: ["FBA"] },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/production-specs`,
      headers: { cookie: adminCookie },
      payload: {
        trim_format: "14x21",
        final_pages: 200,
        paper_interior: "Offset 80g",
        paper_interior_gsm: 80,
        paper_cover: "Couché 250g",
        binding: "broche",
      },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/production-specs`,
      headers: { cookie: adminCookie },
      payload: { lamination: "mate" },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/image-assets`,
      headers: { cookie: adminCookie },
      payload: { type: "couverture_1", resolution_dpi: 300, color_mode: "cmjn", rights_origin: "creation_interne" },
    });

    const document = await prisma.document.create({
      data: { entityType: "manuscript", entityId: manuscript.id, category: "bat", title: "Fichiers BAT" },
    });
    const interiorVersion = await prisma.documentVersion.create({
      data: { documentId: document.id, versionNumber: 1, filePath: "interior.pdf", fileSize: 1000, mimeType: "application/pdf", sha256Hash: "interiorhash", status: "validated" },
    });
    const coverVersion = await prisma.documentVersion.create({
      data: { documentId: document.id, versionNumber: 2, filePath: "cover.pdf", fileSize: 500, mimeType: "application/pdf", sha256Hash: "coverhash", status: "validated" },
    });

    const opened = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/bat`,
      headers: { cookie: adminCookie },
      payload: { interior_version_id: interiorVersion.id, cover_version_id: coverVersion.id },
    });
    const bat = opened.json();
    for (const item of bat.checklist.items) {
      await app.inject({ method: "PATCH", url: `/api/v1/checklist-items/${item.id}`, headers: { cookie: adminCookie }, payload: { checked: true } });
    }
    await app.inject({ method: "PATCH", url: `/api/v1/bat/${bat.id}/status`, headers: { cookie: adminCookie }, payload: { status: "awaiting_signature" } });
    await app.inject({ method: "POST", url: `/api/v1/bat/${bat.id}/sign`, headers: { cookie: adminCookie }, payload: {} });

    return manuscript;
  }

  it("refuse une demande de devis tant que le BAT n'est pas signé (Ch. 15 §15.1)", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: {
        title: "Manuscrit Sans BAT",
        genre_id: genreId,
        language: "fr",
        owner_id: adminId,
        author: { first_name: "Sans", last_name: "BAT" },
      },
    });
    const manuscript = createResponse.json();
    const attempt = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/print-quotes`,
      headers: { cookie: adminCookie },
      payload: { printer_id: printerId, quantities: [500, 1000] },
    });
    expect(attempt.statusCode).toBe(409);
    expect(attempt.json().code).toBe("bat_not_signed");
  });

  it("compare les devis, sélectionne le moins cher et génère un bon de commande (Ch. 15 §15.3-15.4)", async () => {
    const manuscript = await createManuscriptWithSignedBat("Manuscrit Impression Complet");

    const quoteResponse = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/print-quotes`,
      headers: { cookie: adminCookie },
      payload: { printer_id: printerId, quantities: [500, 1000] },
    });
    expect(quoteResponse.statusCode).toBe(201);
    const quote = quoteResponse.json();

    await app.inject({
      method: "PATCH",
      url: `/api/v1/print-quotes/${quote.id}`,
      headers: { cookie: adminCookie },
      payload: { amounts: { "500": 500000, "1000": 800000 }, lead_time_days: 15 },
    });

    const comparison = await app.inject({
      method: "GET",
      url: `/api/v1/manuscripts/${manuscript.id}/print-quotes`,
      headers: { cookie: adminCookie },
    });
    expect(comparison.json().comparison[0].unit_costs["500"]).toBeCloseTo(1000, 2);
    expect(comparison.json().comparison[0].unit_costs["1000"]).toBeCloseTo(800, 2);

    const selected = await app.inject({
      method: "POST",
      url: `/api/v1/print-quotes/${quote.id}/select`,
      headers: { cookie: adminCookie },
      payload: { selection_motive: "Meilleur coût unitaire au tirage de 1000", chosen_quantity: 1000 },
    });
    expect(selected.statusCode).toBe(200);
    expect(selected.json().selectedQuantity).toBe(1000);

    const po = await app.inject({
      method: "POST",
      url: `/api/v1/print-quotes/${quote.id}/purchase-order`,
      headers: { cookie: adminCookie },
      payload: { delivery_due: "2026-09-01T00:00:00.000Z", quantity_tolerance_pct: 2 },
    });
    expect(po.statusCode).toBe(201);
    expect(Number(po.json().amount)).toBe(800000);
    expect(po.json().orderedQuantity).toBe(1000);
    expect(po.json().filesHashReference).toHaveLength(64);
    expect(po.json().poNumber).toMatch(/^PO-\d{4}-\d{4}$/);
  });

  it("exige la validation Direction générale au-delà du seuil de délégation (Ch. 15 §15.3 point 5)", async () => {
    const manuscript = await createManuscriptWithSignedBat("Manuscrit Impression Seuil");
    const quoteResponse = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/print-quotes`,
      headers: { cookie: adminCookie },
      payload: { printer_id: printerId, quantities: [5000] },
    });
    const quote = quoteResponse.json();
    await app.inject({
      method: "PATCH",
      url: `/api/v1/print-quotes/${quote.id}`,
      headers: { cookie: adminCookie },
      payload: { amounts: { "5000": 8_000_000 } },
    });

    const cookie = await loginCookie(app, "resp_impression_printing_test", "RespImpression123!");
    const refused = await app.inject({
      method: "POST",
      url: `/api/v1/print-quotes/${quote.id}/select`,
      headers: { cookie },
      payload: { selection_motive: "Tirage important", chosen_quantity: 5000 },
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe("delegation_threshold_exceeded");

    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/print-quotes/${quote.id}/select`,
      headers: { cookie: adminCookie },
      payload: { selection_motive: "Tirage important", chosen_quantity: 5000 },
    });
    expect(approved.statusCode).toBe(200);
  });

  it("suit les jalons de fabrication et alerte sur retard (Ch. 15 §15.6)", async () => {
    const manuscript = await createManuscriptWithSignedBat("Manuscrit Jalons");
    const quoteResponse = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/print-quotes`,
      headers: { cookie: adminCookie },
      payload: { printer_id: printerId, quantities: [500] },
    });
    const quote = quoteResponse.json();
    await app.inject({ method: "PATCH", url: `/api/v1/print-quotes/${quote.id}`, headers: { cookie: adminCookie }, payload: { amounts: { "500": 400000 } } });
    await app.inject({
      method: "POST",
      url: `/api/v1/print-quotes/${quote.id}/select`,
      headers: { cookie: adminCookie },
      payload: { selection_motive: "OK", chosen_quantity: 500 },
    });
    const poResponse = await app.inject({
      method: "POST",
      url: `/api/v1/print-quotes/${quote.id}/purchase-order`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    const po = poResponse.json();

    const milestone = await app.inject({
      method: "PATCH",
      url: `/api/v1/purchase-orders/${po.id}/milestones/delivered`,
      headers: { cookie: adminCookie },
      payload: { planned_at: "2026-08-01T00:00:00.000Z", actual_at: "2026-08-10T00:00:00.000Z" },
    });
    expect(milestone.statusCode).toBe(200);

    const notification = await prisma.notification.findFirst({ where: { entityId: po.id, title: "Retard de fabrication" } });
    expect(notification).not.toBeNull();
  });

  it("rapproche commande/livraison, signale un écart hors tolérance et gère la réclamation (Ch. 15 §15.7)", async () => {
    const manuscript = await createManuscriptWithSignedBat("Manuscrit Reception");
    const quoteResponse = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/print-quotes`,
      headers: { cookie: adminCookie },
      payload: { printer_id: printerId, quantities: [1000] },
    });
    const quote = quoteResponse.json();
    await app.inject({ method: "PATCH", url: `/api/v1/print-quotes/${quote.id}`, headers: { cookie: adminCookie }, payload: { amounts: { "1000": 700000 } } });
    await app.inject({
      method: "POST",
      url: `/api/v1/print-quotes/${quote.id}/select`,
      headers: { cookie: adminCookie },
      payload: { selection_motive: "OK", chosen_quantity: 1000 },
    });
    const poResponse = await app.inject({
      method: "POST",
      url: `/api/v1/print-quotes/${quote.id}/purchase-order`,
      headers: { cookie: adminCookie },
      payload: { quantity_tolerance_pct: 2 },
    });
    const po = poResponse.json();

    const receipt = await app.inject({
      method: "POST",
      url: `/api/v1/purchase-orders/${po.id}/goods-receipts`,
      headers: { cookie: adminCookie },
      payload: { quantity_received: 950 },
    });
    expect(receipt.statusCode).toBe(201);
    expect(receipt.json().variance).toBe(-50);
    expect(receipt.json().within_tolerance).toBe(false);

    const qc = await app.inject({
      method: "PATCH",
      url: `/api/v1/goods-receipts/${receipt.json().id}/qc`,
      headers: { cookie: adminCookie },
      payload: { verdict: "non_conform" },
    });
    expect(qc.statusCode).toBe(200);

    const claim = await app.inject({
      method: "POST",
      url: `/api/v1/goods-receipts/${receipt.json().id}/claims`,
      headers: { cookie: adminCookie },
      payload: { description: "50 exemplaires manquants" },
    });
    expect(claim.statusCode).toBe(201);

    const resolved = await app.inject({
      method: "PATCH",
      url: `/api/v1/supplier-claims/${claim.json().id}/resolve`,
      headers: { cookie: adminCookie },
      payload: { resolution: "Avoir accordé par l'imprimeur" },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().resolvedAt).not.toBeNull();
  });

  it("gère une réimpression en sous-cycle accéléré, reprenant le dossier signé (Ch. 15 §15.8)", async () => {
    const manuscript = await createManuscriptWithSignedBat("Manuscrit Reimpression");

    const withoutBat = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: {
        title: "Manuscrit Sans BAT Reimpression",
        genre_id: genreId,
        language: "fr",
        owner_id: adminId,
        author: { first_name: "Sans", last_name: "Reimpression" },
      },
    });
    const refused = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${withoutBat.json().id}/reprints`,
      headers: { cookie: adminCookie },
      payload: { printer_id: printerId, quantity: 300, amount: 250000 },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe("no_signed_bat");

    const reprint = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/reprints`,
      headers: { cookie: adminCookie },
      payload: { printer_id: printerId, quantity: 300, amount: 250000 },
    });
    expect(reprint.statusCode).toBe(201);
    expect(reprint.json().reprintNumber).toBe(1);
    expect(reprint.json().filesHashReference).toHaveLength(64);
  });

  it("calcule l'évaluation de l'imprimeur (délais, non-conformité, réclamations, Ch. 15 §15.2)", async () => {
    const detail = await app.inject({ method: "GET", url: `/api/v1/printers/${printerId}`, headers: { cookie: adminCookie } });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.stats.orders_count).toBeGreaterThan(0);
    expect(body.stats.non_conformity_rate).toBeGreaterThan(0);
    expect(body.stats.on_time_rate).toBe(0);
  });
});
