import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie, uniqueIsbnPrefix } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Lot 4 compte auteur (§14) : exemplaires DUS (contrat) vs effectivement REMIS,
// par catégorie ; la remise décrémente le stock.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("compte auteur — dus vs remis (Lot 4)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let genreId: string;
  let warehouseId: string;
  let isbnId: string;
  let contractId: string;
  let partnerId: string;
  const s = Math.random().toString(36).slice(2, 6);

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };
  const physical = async () => {
    const it = await prisma.stockItem.findFirst({ where: { isbnId, locationId: warehouseId, condition: "vendable" } });
    return it?.quantityPhysical ?? 0;
  };
  const account = async () => (await app.inject({ method: "GET", url: `/api/v1/author-copies/account?contract_id=${contractId}`, headers: { cookie } })).json();

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login("admin", ADMIN_PASSWORD);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
    warehouseId = (await app.inject({ method: "POST", url: "/api/v1/stock-locations", headers: { cookie }, payload: { type: "entrepot", label: `Magasin auteur ${s}` } })).json().id;
    const ms = (await app.inject({ method: "POST", url: "/api/v1/manuscripts", headers: { cookie }, payload: { title: `Ouvrage auteur ${s}`, genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "Aut", last_name: s } } })).json();
    partnerId = (await prisma.workContributor.findFirstOrThrow({ where: { manuscriptId: ms.id } })).partnerId;
    const contract = (await app.inject({ method: "POST", url: "/api/v1/contracts", headers: { cookie }, payload: { type: "edition", manuscript_id: ms.id, partner_id: partnerId, financial_terms: {} } })).json();
    contractId = contract.id;
    for (const st of ["legal_review", "direction_approval", "awaiting_signature", "active"]) {
      await app.inject({ method: "PATCH", url: `/api/v1/contracts/${contractId}/status`, headers: { cookie }, payload: { status: st } });
    }
    const pool = (await app.inject({ method: "POST", url: "/api/v1/isbn-pools", headers: { cookie }, payload: { prefix: uniqueIsbnPrefix(1), digit_width: 1, range_start: 0, range_end: 9 } })).json();
    isbnId = (await app.inject({ method: "POST", url: `/api/v1/manuscripts/${ms.id}/isbn`, headers: { cookie }, payload: { format: "print", pool_id: pool.id } })).json().id;
    await app.inject({ method: "POST", url: "/api/v1/stock-movements", headers: { cookie }, payload: { type: "production_in", isbn_id: isbnId, print_run: 0, to_location_id: warehouseId, quantity: 1000, reason: "Fabrication" } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("fixe les exemplaires dus au titre du contrat", async () => {
    const res = await app.inject({ method: "PATCH", url: `/api/v1/contracts/${contractId}/author-free-copies`, headers: { cookie }, payload: { author_free_copies: 3 } });
    expect(res.statusCode).toBe(200);
    const acc = await account();
    expect(acc.author_free_copies).toBe(3);
    expect(acc.encore_dus).toBe(3); // rien remis encore
    expect(acc.remis_total).toBe(0);
  });

  it("CAS 2 — remise de 50 exemplaires à l'auteur décrémente le stock", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/author-copies", headers: { cookie },
      payload: { partner_id: partnerId, isbn_id: isbnId, contract_id: contractId, category: "gratuit", quantity: 50, from_location_id: warehouseId },
    });
    expect(res.statusCode).toBe(201);
    expect(await physical()).toBe(950);
    const acc = await account();
    expect(acc.remis_total).toBe(50);
    expect(acc.by_category.gratuit).toBe(50);
    // Les 50 gratuits n'imputent pas les exemplaires DUS au contrat.
    expect(acc.encore_dus).toBe(3);
  });

  it("les remises « au titre du contrat » imputent les exemplaires dus", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/author-copies", headers: { cookie },
      payload: { partner_id: partnerId, isbn_id: isbnId, contract_id: contractId, category: "contractuel", quantity: 3, from_location_id: warehouseId },
    });
    expect(res.statusCode).toBe(201);
    const acc = await account();
    expect(acc.remis_contractuel).toBe(3);
    expect(acc.encore_dus).toBe(0); // dus 3 − remis contractuel 3
    expect(acc.remis_total).toBe(53);
    expect(await physical()).toBe(947);
  });

  it("refuse une remise supérieure au stock disponible", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/author-copies", headers: { cookie },
      payload: { partner_id: partnerId, isbn_id: isbnId, contract_id: contractId, category: "promotionnel", quantity: 999999, from_location_id: warehouseId },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("stock_negative");
  });
});
