import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie, uniqueIsbnPrefix } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Lot 3 stock commercial (§10) : remise magasin → commercial (≠ vente), suivi
// reçus / vendus / retournés / détenus (à justifier), cloisonnement par rôle.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("stock commercial individuel (Lot 3)", () => {
  let app: FastifyInstance;
  let cookie: string; // admin/magasinier
  let adminId: string;
  let genreId: string;
  let warehouseId: string;
  let isbnId: string;
  let commercial: { id: string };
  let commCookie: string;
  let respCookie: string;
  let commLocationId: string;
  const s = Math.random().toString(36).slice(2, 6);

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };
  const detenus = async () => {
    const items = await prisma.stockItem.findMany({ where: { locationId: commLocationId } });
    return items.reduce((t, i) => t + i.quantityPhysical, 0);
  };

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login("admin", ADMIN_PASSWORD);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
    warehouseId = (await app.inject({ method: "POST", url: "/api/v1/stock-locations", headers: { cookie }, payload: { type: "entrepot", label: `Magasin ${s}` } })).json().id;

    // Ouvrage + ISBN + 1000 exemplaires en magasin.
    const ms = (await app.inject({ method: "POST", url: "/api/v1/manuscripts", headers: { cookie }, payload: { title: `Ouvrage ${s}`, genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "A", last_name: s } } })).json();
    const partnerId = (await prisma.workContributor.findFirstOrThrow({ where: { manuscriptId: ms.id } })).partnerId;
    const contract = (await app.inject({ method: "POST", url: "/api/v1/contracts", headers: { cookie }, payload: { type: "edition", manuscript_id: ms.id, partner_id: partnerId, financial_terms: {} } })).json();
    for (const st of ["legal_review", "direction_approval", "awaiting_signature", "active"]) {
      await app.inject({ method: "PATCH", url: `/api/v1/contracts/${contract.id}/status`, headers: { cookie }, payload: { status: st } });
    }
    const pool = (await app.inject({ method: "POST", url: "/api/v1/isbn-pools", headers: { cookie }, payload: { prefix: uniqueIsbnPrefix(1), digit_width: 1, range_start: 0, range_end: 9 } })).json();
    isbnId = (await app.inject({ method: "POST", url: `/api/v1/manuscripts/${ms.id}/isbn`, headers: { cookie }, payload: { format: "print", pool_id: pool.id } })).json().id;
    await app.inject({ method: "POST", url: "/api/v1/stock-movements", headers: { cookie }, payload: { type: "production_in", isbn_id: isbnId, print_run: 0, to_location_id: warehouseId, quantity: 1000, reason: "Fabrication" } });

    commercial = await createUserWithRole(`com_${s}`, "COMMERCIAL", "Com1pass!");
    await createUserWithRole(`resp_${s}`, "RESP_COMMERCIAL", "Resp123!");
    commCookie = await login(`com_${s}`, "Com1pass!");
    respCookie = await login(`resp_${s}`, "Resp123!");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("CAS 3 — remise de 100 exemplaires au commercial (≠ vente)", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/commercial-stock/${commercial.id}/handover`, headers: { cookie }, payload: { isbn_id: isbnId, quantity: 100, location_id: warehouseId } });
    expect(res.statusCode).toBe(201);
    commLocationId = res.json().toLocationId;
    expect(await detenus()).toBe(100);
    // Le mouvement est un transfert, pas une vente.
    expect(res.json().type).toBe("transfer");
  });

  it("CAS 4 — 40 vendus par le commercial diminuent son stock à justifier", async () => {
    await app.inject({ method: "POST", url: "/api/v1/stock-movements", headers: { cookie }, payload: { type: "sale_out", isbn_id: isbnId, print_run: 0, from_location_id: commLocationId, quantity: 40, reason: "Vente terrain" } });
    expect(await detenus()).toBe(60);
  });

  it("CAS 5 — 10 exemplaires retournés au magasin", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/commercial-stock/${commercial.id}/return`, headers: { cookie }, payload: { isbn_id: isbnId, quantity: 10, location_id: warehouseId } });
    expect(res.statusCode).toBe(201);
    expect(await detenus()).toBe(50);
  });

  it("le responsable voit l'état par commercial : reçus 100, vendus 40, retournés 10, à justifier 50", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/commercial-stock", headers: { cookie: respCookie } });
    expect(res.statusCode).toBe(200);
    const row = (res.json().reps as Array<{ user_id: string; recus: number; vendus: number; retournes: number; a_justifier: number }>).find((r) => r.user_id === commercial.id);
    expect(row).toBeDefined();
    expect(row!.recus).toBe(100);
    expect(row!.vendus).toBe(40);
    expect(row!.retournes).toBe(10);
    expect(row!.a_justifier).toBe(50);
  });

  it("le commercial voit SON propre état via /mine", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/commercial-stock/mine", headers: { cookie: commCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().a_justifier).toBe(50);
  });

  it("un commercial simple n'accède PAS à l'état de tous les commerciaux (403)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/commercial-stock", headers: { cookie: commCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("refuse une remise supérieure au stock magasin disponible", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/commercial-stock/${commercial.id}/handover`, headers: { cookie }, payload: { isbn_id: isbnId, quantity: 999999, location_id: warehouseId } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("stock_negative");
  });

  it("accepte une date de remise antérieure au jour en cours (saisie a posteriori)", async () => {
    const passe = new Date(Date.now() - 5 * 24 * 3600 * 1000); // il y a 5 jours
    const res = await app.inject({ method: "POST", url: `/api/v1/commercial-stock/${commercial.id}/handover`, headers: { cookie }, payload: { isbn_id: isbnId, quantity: 3, location_id: warehouseId, moved_at: passe.toISOString() } });
    expect(res.statusCode).toBe(201);
    const mv = await prisma.stockMovement.findUniqueOrThrow({ where: { id: res.json().id } });
    // La date de mouvement enregistrée est bien la date renseignée, pas « maintenant ».
    expect(Math.abs(mv.movedAt.getTime() - passe.getTime())).toBeLessThan(1000);
  });

  it("refuse une date de remise dans le futur", async () => {
    const futur = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const res = await app.inject({ method: "POST", url: `/api/v1/commercial-stock/${commercial.id}/handover`, headers: { cookie }, payload: { isbn_id: isbnId, quantity: 1, location_id: warehouseId, moved_at: futur.toISOString() } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("date_future");
  });
});
