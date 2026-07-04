import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie, uniqueIsbnPrefix } from "./helpers.js";
import { computeEan13CheckDigit, isbn13ToBarcodeSvg } from "../src/lib/barcode.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(response.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("ISBN, dépôt légal et métadonnées (Lot 3)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let genreId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const genre = await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } });
    genreId = genre.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createManuscriptWithActiveContract(title: string) {
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
    return manuscript;
  }

  it("calcule une clé de contrôle EAN-13 correcte (numéro ISBN de référence)", () => {
    expect(computeEan13CheckDigit("978030640615")).toBe(7);
  });

  it("génère un SVG de code-barres bien formé à partir d'un ISBN-13", () => {
    const svg = isbn13ToBarcodeSvg("9780306406157");
    expect(svg).toContain("<svg");
    expect(svg).toContain("9780306406157");
    expect(() => isbn13ToBarcodeSvg("12345")).toThrow();
  });

  it("attribue le prochain ISBN disponible d'une tranche et journalise l'attribution", async () => {
    const pool = await app.inject({
      method: "POST",
      url: "/api/v1/isbn-pools",
      headers: { cookie: adminCookie },
      payload: { prefix: uniqueIsbnPrefix(2), digit_width: 2, range_start: 0, range_end: 99 },
    });
    expect(pool.statusCode).toBe(201);

    const manuscript = await createManuscriptWithActiveContract("Manuscrit ISBN");
    const attribution = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/isbn`,
      headers: { cookie: adminCookie },
      payload: { format: "print", pool_id: pool.json().id },
    });
    expect(attribution.statusCode).toBe(201);
    const isbn = attribution.json();
    expect(isbn.isbn13).toHaveLength(13);
    expect(isbn.isbn13.startsWith(pool.json().prefix)).toBe(true);

    const barcode = await app.inject({
      method: "GET",
      url: `/api/v1/isbn/${isbn.id}/barcode`,
      headers: { cookie: adminCookie },
    });
    expect(barcode.statusCode).toBe(200);
    expect(barcode.headers["content-type"]).toContain("image/svg+xml");

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/isbn`,
      headers: { cookie: adminCookie },
      payload: { format: "print", pool_id: pool.json().id },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe("isbn_already_assigned");
  });

  it("refuse l'attribution d'un ISBN sans contrat actif (Ch. 13 §13.3)", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: {
        title: "Manuscrit Sans Contrat ISBN",
        genre_id: genreId,
        language: "fr",
        owner_id: adminId,
        author: { first_name: "Sans", last_name: "Contrat" },
      },
    });
    const manuscript = createResponse.json();
    const attribution = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/isbn`,
      headers: { cookie: adminCookie },
      payload: { format: "print" },
    });
    expect(attribution.statusCode).toBe(409);
    expect(attribution.json().code).toBe("contract_required");
  });

  it("ne réutilise jamais un ISBN attribué même si le titre est ensuite abandonné (Ch. 13 §13.2)", async () => {
    const pool = await app.inject({
      method: "POST",
      url: "/api/v1/isbn-pools",
      headers: { cookie: adminCookie },
      payload: { prefix: uniqueIsbnPrefix(1), digit_width: 1, range_start: 0, range_end: 0 },
    });
    const manuscript = await createManuscriptWithActiveContract("Manuscrit Abandonné");
    const attribution = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/isbn`,
      headers: { cookie: adminCookie },
      payload: { format: "print", pool_id: pool.json().id },
    });
    expect(attribution.statusCode).toBe(201);

    await prisma.manuscript.update({ where: { id: manuscript.id }, data: { deletedAt: new Date() } });

    const exhausted = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/isbn`,
      headers: { cookie: adminCookie },
      payload: { format: "epub", pool_id: pool.json().id },
    });
    expect(exhausted.statusCode).toBe(404);

    const stillAssigned = await prisma.isbn.findUnique({ where: { id: attribution.json().id } });
    expect(stillAssigned?.status).toBe("assigned");
  });

  it("gère la fiche de métadonnées versionnée et signale les partenaires déjà notifiés (Ch. 13 §13.8)", async () => {
    const manuscript = await createManuscriptWithActiveContract("Manuscrit Métadonnées");

    const firstUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/metadata`,
      headers: { cookie: adminCookie },
      payload: { summary: "Résumé initial", weight_grams: 300, thema_codes: ["FBA"] },
    });
    expect(firstUpdate.statusCode).toBe(200);
    expect(firstUpdate.json().version).toBe(1);

    const exportResponse = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/metadata-exports`,
      headers: { cookie: adminCookie },
      payload: { format: "csv" },
    });
    expect(exportResponse.statusCode).toBe(201);
    expect(exportResponse.json().needsResend).toBe(false);

    const secondUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/metadata`,
      headers: { cookie: adminCookie },
      payload: { summary: "Résumé révisé" },
    });
    expect(secondUpdate.json().version).toBe(2);

    const exports = await app.inject({
      method: "GET",
      url: `/api/v1/manuscripts/${manuscript.id}/metadata-exports`,
      headers: { cookie: adminCookie },
    });
    expect(exports.json()[0].needsResend).toBe(true);
  });

  it("contrôle de complétude bloquant : signale les éléments manquants avant le BAT (Ch. 13 §13.9)", async () => {
    const manuscript = await createManuscriptWithActiveContract("Manuscrit Complétude");

    const before = await app.inject({
      method: "GET",
      url: `/api/v1/manuscripts/${manuscript.id}/isbn-completeness`,
      headers: { cookie: adminCookie },
    });
    expect(before.json().complete).toBe(false);
    expect(before.json().missing).toContain("isbn_attribue");

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

    const after = await app.inject({
      method: "GET",
      url: `/api/v1/manuscripts/${manuscript.id}/isbn-completeness`,
      headers: { cookie: adminCookie },
    });
    expect(after.json().complete).toBe(true);
    expect(after.json().missing).toHaveLength(0);
  });

  it("alerte quand le stock d'ISBN disponibles passe sous le seuil paramétrable (Ch. 13 §13.2)", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/isbn-pools",
      headers: { cookie: adminCookie },
      payload: { prefix: uniqueIsbnPrefix(1), digit_width: 1, range_start: 0, range_end: 0 },
    });
    const manuscript = await createManuscriptWithActiveContract("Manuscrit Stock Bas");
    await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/isbn`,
      headers: { cookie: adminCookie },
      payload: { format: "print" },
    });

    const notification = await prisma.notification.findFirst({
      where: { type: "alerte_stock", title: "Stock d'ISBN bas" },
      orderBy: { createdAt: "desc" },
    });
    expect(notification).not.toBeNull();
  });
});
