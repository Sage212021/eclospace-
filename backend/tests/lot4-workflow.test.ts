import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie, uniqueIsbnPrefix, seedManuscriptSourceFile, seedCorrectionCycle, seedStepDeliverable, realizationPayload } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(response.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("Intégration workflow — étapes 16 à 18 (Lot 4)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let genreId: string;
  let printerId: string;
  let warehouseId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const genre = await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } });
    genreId = genre.id;

    const partner = await prisma.partner.create({ data: { category: "imprimeur", firstName: "Presses", lastName: "Workflow Lot4" } });
    const printer = await app.inject({ method: "POST", url: "/api/v1/printers", headers: { cookie: adminCookie }, payload: { partner_id: partner.id, specialties: [] } });
    printerId = printer.json().id;

    const warehouse = await app.inject({
      method: "POST",
      url: "/api/v1/stock-locations",
      headers: { cookie: adminCookie },
      payload: { type: "entrepot", label: "Entrepôt workflow Lot4" },
    });
    warehouseId = warehouse.json().id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function validate(manuscriptId: string, step: string, payload: Record<string, unknown> = {}) {
    return app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscriptId}/steps/${step}/validate`,
      headers: { cookie: adminCookie },
      payload,
    });
  }

  // Mène un manuscrit jusqu'à l'étape ENTREE_STOCK (reprend le circuit complet
  // du Lot 3, cf. tests/lot3-workflow.test.ts).
  async function createManuscriptAtEntreeStock(title: string) {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: { title, genre_id: genreId, language: "fr", owner_id: adminId, evaluation_fee_choice: "sans_frais", author: { first_name: "Auteur", last_name: title, email: "auteur@example.com", id_type: "CNI", id_number: "100200300" } },
    });
    const manuscript = createResponse.json();
    await seedManuscriptSourceFile(manuscript.id);

    await validate(manuscript.id, "VERIF_ADMIN");
    const assignResponse = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/reading-assignments`,
      headers: { cookie: adminCookie },
      payload: { reader_id: adminId, due_at: "2026-12-31T00:00:00.000Z" },
    });
    const assignment = assignResponse.json();
    const criteria = await prisma.evaluationCriterion.findMany();
    await app.inject({
      method: "POST",
      url: `/api/v1/reading-assignments/${assignment.id}/evaluation`,
      headers: { cookie: adminCookie },
      payload: { scores: criteria.map((c) => ({ criterion_id: c.id, score: 8 })), recommendation: "accept" },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/editorial-decision`,
      headers: { cookie: adminCookie },
      payload: { decision: "acceptation", motivation: "Bon texte." },
    });

    const partnerId = (await prisma.workContributor.findFirstOrThrow({ where: { manuscriptId: manuscript.id } })).partnerId;
    const contractResponse = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { cookie: adminCookie },
      payload: { type: "edition", manuscript_id: manuscript.id, partner_id: partnerId, financial_terms: {} },
    });
    const contract = contractResponse.json();
    for (const status of ["legal_review", "direction_approval", "awaiting_signature", "active"]) {
      await app.inject({ method: "PATCH", url: `/api/v1/contracts/${contract.id}/status`, headers: { cookie: adminCookie }, payload: { status } });
    }
    // Depuis D-010, la décision éditoriale mène à la PLANIFICATION ; la
    // contractualisation est franchie plus tard, juste après la validation du BAT.
    await seedStepDeliverable(manuscript.id, "PLANIFICATION");
    await validate(manuscript.id, "PLANIFICATION", realizationPayload("PLANIFICATION"));
    await seedCorrectionCycle(manuscript.id);
    await validate(manuscript.id, "CORRECTION");
    // Étapes « à option » Expertise & Réécriture (nouveau modèle 20/08/2026) :
    // passées ici pour atteindre la production.
    await validate(manuscript.id, "EXPERTISE", { step_decision: "passe", skip_reason: "N/A pour ce test" });
    await validate(manuscript.id, "REECRITURE", { step_decision: "passe", skip_reason: "N/A pour ce test" });

    await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/production-specs`,
      headers: { cookie: adminCookie },
      payload: { trim_format: "14x21", final_pages: 200, paper_interior: "Offset 80g", paper_interior_gsm: 80, paper_cover: "Couché 250g", binding: "broche" },
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
    await validate(manuscript.id, "MISE_EN_PAGE");
    await validate(manuscript.id, "INFOGRAPHIE");

    const pool = await app.inject({
      method: "POST",
      url: "/api/v1/isbn-pools",
      headers: { cookie: adminCookie },
      payload: { prefix: uniqueIsbnPrefix(1), digit_width: 1, range_start: 0, range_end: 9 },
    });
    const isbn = await app.inject({
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
    await validate(manuscript.id, "ATTRIBUTION_REFERENCES");

    const document = await prisma.document.create({ data: { entityType: "manuscript", entityId: manuscript.id, category: "bat", title: "Fichiers BAT" } });
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
    await validate(manuscript.id, "VALIDATION_BAT");
    // D-010 : la contractualisation suit désormais la validation du BAT.
    await validate(manuscript.id, "CONTRACTUALISATION");

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
    const poResponse = await app.inject({ method: "POST", url: `/api/v1/print-quotes/${quote.id}/purchase-order`, headers: { cookie: adminCookie }, payload: {} });
    const po = poResponse.json();
    await app.inject({ method: "PATCH", url: `/api/v1/purchase-orders/${po.id}/status`, headers: { cookie: adminCookie }, payload: { status: "sent" } });
    await validate(manuscript.id, "IMPRESSION");

    const receipt = await app.inject({
      method: "POST",
      url: `/api/v1/purchase-orders/${po.id}/goods-receipts`,
      headers: { cookie: adminCookie },
      payload: { quantity_received: 500 },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/goods-receipts/${receipt.json().id}/qc`,
      headers: { cookie: adminCookie },
      payload: { verdict: "conform" },
    });
    const validatedCq = await validate(manuscript.id, "CONTROLE_QUALITE_IMPRESSION");
    expect(validatedCq.statusCode).toBe(200);
    expect(validatedCq.json().status).toBe("ENTREE_STOCK");

    return { manuscript, receiptId: receipt.json().id as string };
  }

  it("bloque ENTREE_STOCK tant qu'aucun exemplaire n'est réceptionné en stock (Ch. 16 §16.4)", async () => {
    const { manuscript, receiptId } = await createManuscriptAtEntreeStock("Manuscrit Workflow Lot4 Stock");

    const blocked = await validate(manuscript.id, "ENTREE_STOCK");
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("no_stock_entry");

    await app.inject({
      method: "POST",
      url: `/api/v1/goods-receipts/${receiptId}/stock-entry`,
      headers: { cookie: adminCookie },
      payload: { location_id: warehouseId },
    });

    const advanced = await validate(manuscript.id, "ENTREE_STOCK");
    expect(advanced.statusCode).toBe(200);
    expect(advanced.json().status).toBe("COMMERCIALISATION");
  });

  it("bloque COMMERCIALISATION tant qu'aucun prix public n'est défini (Ch. 17 §17.2)", async () => {
    const { manuscript, receiptId } = await createManuscriptAtEntreeStock("Manuscrit Workflow Lot4 Prix");
    await app.inject({
      method: "POST",
      url: `/api/v1/goods-receipts/${receiptId}/stock-entry`,
      headers: { cookie: adminCookie },
      payload: { location_id: warehouseId },
    });
    await validate(manuscript.id, "ENTREE_STOCK");

    const isbn = await prisma.isbn.findFirstOrThrow({ where: { manuscriptId: manuscript.id, format: "print" } });
    const blocked = await validate(manuscript.id, "COMMERCIALISATION");
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("price_missing");

    await app.inject({
      method: "POST",
      url: `/api/v1/isbn/${isbn.id}/prices`,
      headers: { cookie: adminCookie },
      payload: { country: "France", currency: "EUR", price: 18.9, effective_from: "2026-07-01T00:00:00.000Z" },
    });

    const advanced = await validate(manuscript.id, "COMMERCIALISATION");
    expect(advanced.statusCode).toBe(200);
    expect(advanced.json().status).toBe("VENTE_LIVRAISON");
  });

  it("bloque VENTE_LIVRAISON tant qu'aucune commande ou vente n'est enregistrée (Ch. 17 §17.5)", async () => {
    const { manuscript, receiptId } = await createManuscriptAtEntreeStock("Manuscrit Workflow Lot4 Vente");
    await app.inject({
      method: "POST",
      url: `/api/v1/goods-receipts/${receiptId}/stock-entry`,
      headers: { cookie: adminCookie },
      payload: { location_id: warehouseId },
    });
    await validate(manuscript.id, "ENTREE_STOCK");
    const isbn = await prisma.isbn.findFirstOrThrow({ where: { manuscriptId: manuscript.id, format: "print" } });
    await app.inject({
      method: "POST",
      url: `/api/v1/isbn/${isbn.id}/prices`,
      headers: { cookie: adminCookie },
      payload: { country: "France", currency: "EUR", price: 18.9, effective_from: "2026-07-01T00:00:00.000Z" },
    });
    await validate(manuscript.id, "COMMERCIALISATION");

    const blocked = await validate(manuscript.id, "VENTE_LIVRAISON");
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("no_sale_recorded");

    await app.inject({
      method: "POST",
      url: "/api/v1/pos-sales",
      headers: { cookie: adminCookie },
      payload: { isbn_id: isbn.id, location_id: warehouseId, quantity: 1, unit_price: 18.9, payment_method: "cash" },
    });

    const advanced = await validate(manuscript.id, "VENTE_LIVRAISON");
    expect(advanced.statusCode).toBe(200);
    expect(advanced.json().status).toBe("SUIVI_POST_PUBLICATION");
  });
});
