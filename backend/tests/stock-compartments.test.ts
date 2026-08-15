import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie, uniqueIsbnPrefix } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Lot 1 magasin : compartiments de stock (vendable / déclassé / perdu / détruit)
// et nouveaux types de mouvements — dont les reclassements perte / casse /
// destruction qui déplacent la quantité d'un compartiment à l'autre AU MÊME LIEU
// (le total reste constant : rien ne disparaît, tout reste traçable).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("compartiments de stock & types de mouvements (Lot 1)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let genreId: string;
  let warehouseId: string;

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };
  const compartments = async (isbnId: string, locationId: string) => {
    const items = await prisma.stockItem.findMany({ where: { isbnId, locationId } });
    const get = (c: string) => items.find((i) => i.condition === c)?.quantityPhysical ?? 0;
    return { vendable: get("vendable"), declasse: get("declasse"), perdu: get("perdu"), detruit: get("detruit") };
  };
  const move = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/v1/stock-movements", headers: { cookie }, payload: { print_run: 0, ...payload } });

  async function newIsbn(title: string) {
    const created = await app.inject({ method: "POST", url: "/api/v1/manuscripts", headers: { cookie }, payload: { title, genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "Auteur", last_name: title } } });
    const manuscript = created.json();
    const partnerId = (await prisma.workContributor.findFirstOrThrow({ where: { manuscriptId: manuscript.id } })).partnerId;
    const contract = (await app.inject({ method: "POST", url: "/api/v1/contracts", headers: { cookie }, payload: { type: "edition", manuscript_id: manuscript.id, partner_id: partnerId, financial_terms: {} } })).json();
    for (const status of ["legal_review", "direction_approval", "awaiting_signature", "active"]) {
      await app.inject({ method: "PATCH", url: `/api/v1/contracts/${contract.id}/status`, headers: { cookie }, payload: { status } });
    }
    const pool = await app.inject({ method: "POST", url: "/api/v1/isbn-pools", headers: { cookie }, payload: { prefix: uniqueIsbnPrefix(1), digit_width: 1, range_start: 0, range_end: 9 } });
    const isbn = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/isbn`, headers: { cookie }, payload: { format: "print", pool_id: pool.json().id } });
    return isbn.json().id as string;
  }

  beforeAll(async () => {
    app = await buildApp();
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    cookie = await login("admin", ADMIN_PASSWORD);
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
    warehouseId = (await app.inject({ method: "POST", url: "/api/v1/stock-locations", headers: { cookie }, payload: { type: "entrepot", label: "Entrepôt compartiments" } })).json().id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("CAS 1 — production de 1000 exemplaires en vendable", async () => {
    const isbnId = await newIsbn("Compartiments Production");
    const r = await move({ type: "production_in", isbn_id: isbnId, to_location_id: warehouseId, quantity: 1000, reason: "Réception fabrication" });
    expect(r.statusCode).toBe(201);
    expect(await compartments(isbnId, warehouseId)).toMatchObject({ vendable: 1000, declasse: 0, perdu: 0, detruit: 0 });
  });

  it("CAS 7 — 5 exemplaires endommagés (casse) passent vendable → déclassé, total constant", async () => {
    const isbnId = await newIsbn("Compartiments Casse");
    await move({ type: "production_in", isbn_id: isbnId, to_location_id: warehouseId, quantity: 100, reason: "Réception" });
    const r = await move({ type: "damage", isbn_id: isbnId, from_location_id: warehouseId, quantity: 5, reason: "Chute palette" });
    expect(r.statusCode).toBe(201);
    const c = await compartments(isbnId, warehouseId);
    expect(c).toMatchObject({ vendable: 95, declasse: 5 });
    expect(c.vendable + c.declasse + c.perdu + c.detruit).toBe(100); // rien ne disparaît
  });

  it("perte → compartiment perdu ; destruction → compartiment détruit", async () => {
    const isbnId = await newIsbn("Compartiments Perte Destruction");
    await move({ type: "production_in", isbn_id: isbnId, to_location_id: warehouseId, quantity: 50, reason: "Réception" });
    expect((await move({ type: "loss", isbn_id: isbnId, from_location_id: warehouseId, quantity: 4, reason: "Manquant inventaire" })).statusCode).toBe(201);
    expect((await move({ type: "destruction", isbn_id: isbnId, from_location_id: warehouseId, quantity: 6, reason: "Invendables détruits" })).statusCode).toBe(201);
    const c = await compartments(isbnId, warehouseId);
    expect(c).toMatchObject({ vendable: 40, perdu: 4, detruit: 6 });
    expect(c.vendable + c.declasse + c.perdu + c.detruit).toBe(50);
  });

  it("entrée fournisseur crédite le vendable ; sortie promotionnelle le débite", async () => {
    const isbnId = await newIsbn("Compartiments Fournisseur");
    expect((await move({ type: "supplier_in", isbn_id: isbnId, to_location_id: warehouseId, quantity: 30, reason: "Achat fournisseur" })).statusCode).toBe(201);
    expect((await move({ type: "promotional_out", isbn_id: isbnId, from_location_id: warehouseId, quantity: 10, reason: "Salon du livre" })).statusCode).toBe(201);
    expect((await compartments(isbnId, warehouseId)).vendable).toBe(20);
  });

  it("annuler une casse restitue le compartiment vendable (contre-passation exacte)", async () => {
    const isbnId = await newIsbn("Compartiments Annulation");
    await move({ type: "production_in", isbn_id: isbnId, to_location_id: warehouseId, quantity: 20, reason: "Réception" });
    const dmg = (await move({ type: "damage", isbn_id: isbnId, from_location_id: warehouseId, quantity: 8, reason: "Erreur de saisie" })).json();
    expect(await compartments(isbnId, warehouseId)).toMatchObject({ vendable: 12, declasse: 8 });
    const cancel = await app.inject({ method: "POST", url: `/api/v1/stock-movements/${dmg.id}/cancel`, headers: { cookie }, payload: { reason: "Fausse casse" } });
    expect(cancel.statusCode).toBe(200);
    expect(await compartments(isbnId, warehouseId)).toMatchObject({ vendable: 20, declasse: 0 });
  });

  it("refuse une perte supérieure au stock vendable (jamais de négatif)", async () => {
    const isbnId = await newIsbn("Compartiments Négatif");
    await move({ type: "production_in", isbn_id: isbnId, to_location_id: warehouseId, quantity: 5, reason: "Réception" });
    const r = await move({ type: "loss", isbn_id: isbnId, from_location_id: warehouseId, quantity: 9, reason: "Perte" });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("stock_negative");
    expect((await compartments(isbnId, warehouseId)).vendable).toBe(5); // inchangé
  });

  it("le stock consolidé ventile par compartiment (vendable / déclassé / perdu / détruit)", async () => {
    const isbnId = await newIsbn("Compartiments Consolidé");
    await move({ type: "production_in", isbn_id: isbnId, to_location_id: warehouseId, quantity: 100, reason: "Réception" });
    await move({ type: "loss", isbn_id: isbnId, from_location_id: warehouseId, quantity: 3, reason: "Perte" });
    await move({ type: "destruction", isbn_id: isbnId, from_location_id: warehouseId, quantity: 2, reason: "Destruction" });
    const res = await app.inject({ method: "GET", url: "/api/v1/stock-consolidated", headers: { cookie } });
    const row = (res.json().rows as Array<{ isbn_id: string; vendable: number; perdu: number; detruit: number; total: number }>).find((r) => r.isbn_id === isbnId);
    expect(row).toBeDefined();
    expect(row!.vendable).toBe(95);
    expect(row!.perdu).toBe(3);
    expect(row!.detruit).toBe(2);
    expect(row!.total).toBe(100); // somme de tous les compartiments
  });
});
