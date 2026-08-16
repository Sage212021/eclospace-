import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie, uniqueIsbnPrefix } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Garde-fou anti-négatif (option C) : une sortie supérieure au stock réel est
// refusée (409) — le stock physique ne peut jamais passer sous zéro.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("garde-fou anti-négatif sur les mouvements", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let genreId: string;
  let warehouseId: string;
  let isbnId: string;
  const s = Math.random().toString(36).slice(2, 6);

  const physical = async () => {
    const it = await prisma.stockItem.findFirst({ where: { isbnId, locationId: warehouseId, condition: "vendable" } });
    return it?.quantityPhysical ?? 0;
  };

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
    warehouseId = (await app.inject({ method: "POST", url: "/api/v1/stock-locations", headers: { cookie }, payload: { type: "entrepot", label: `Magasin garde ${s}` } })).json().id;
    const ms = (await app.inject({ method: "POST", url: "/api/v1/manuscripts", headers: { cookie }, payload: { title: `Garde ${s}`, genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "A", last_name: s } } })).json();
    const partnerId = (await prisma.workContributor.findFirstOrThrow({ where: { manuscriptId: ms.id } })).partnerId;
    const contract = (await app.inject({ method: "POST", url: "/api/v1/contracts", headers: { cookie }, payload: { type: "edition", manuscript_id: ms.id, partner_id: partnerId, financial_terms: {} } })).json();
    for (const st of ["legal_review", "direction_approval", "awaiting_signature", "active"]) {
      await app.inject({ method: "PATCH", url: `/api/v1/contracts/${contract.id}/status`, headers: { cookie }, payload: { status: st } });
    }
    const pool = (await app.inject({ method: "POST", url: "/api/v1/isbn-pools", headers: { cookie }, payload: { prefix: uniqueIsbnPrefix(1), digit_width: 1, range_start: 0, range_end: 9 } })).json();
    isbnId = (await app.inject({ method: "POST", url: `/api/v1/manuscripts/${ms.id}/isbn`, headers: { cookie }, payload: { format: "print", pool_id: pool.id } })).json().id;
    await app.inject({ method: "POST", url: "/api/v1/stock-movements", headers: { cookie }, payload: { type: "production_in", isbn_id: isbnId, print_run: 0, to_location_id: warehouseId, quantity: 60, reason: "Réception" } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("refuse une Sortie vente de 80 sur un stock de 60 (409) et laisse le stock intact", async () => {
    expect(await physical()).toBe(60);
    const res = await app.inject({ method: "POST", url: "/api/v1/stock-movements", headers: { cookie }, payload: { type: "sale_out", isbn_id: isbnId, print_run: 0, from_location_id: warehouseId, quantity: 80, reason: "Vente" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("stock_negative");
    expect(await physical()).toBe(60); // inchangé
  });

  it("accepte une sortie dans la limite du stock", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/stock-movements", headers: { cookie }, payload: { type: "sale_out", isbn_id: isbnId, print_run: 0, from_location_id: warehouseId, quantity: 60, reason: "Vente" } });
    expect(res.statusCode).toBe(201);
    expect(await physical()).toBe(0);
  });
});
