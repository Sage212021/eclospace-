import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie, uniqueIsbnPrefix } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Correction des saisies de stock par le magasinier (option Modifier / Annuler).
// Le stock est recalculé atomiquement ; les écritures ne sont jamais figées.
// Seules les saisies MANUELLES non annulées sont modifiables.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("correction des mouvements de stock", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let genreId: string;
  let warehouseId: string;

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  const physical = async (isbnId: string, locationId: string) => {
    const item = await prisma.stockItem.findFirst({ where: { isbnId, locationId, condition: "vendable" } });
    return item?.quantityPhysical ?? 0;
  };

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

  const entry = (isbnId: string, quantity: number, extra: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: "/api/v1/stock-movements", headers: { cookie }, payload: { type: "production_in", isbn_id: isbnId, print_run: 0, to_location_id: warehouseId, quantity, reason: "Réception fabrication", ...extra } });

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    cookie = await login("admin", ADMIN_PASSWORD);
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
    warehouseId = (await app.inject({ method: "POST", url: "/api/v1/stock-locations", headers: { cookie }, payload: { type: "entrepot", label: "Entrepôt correction" } })).json().id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("MODIFIER une quantité saisie par erreur recalcule le stock", async () => {
    const isbnId = await newIsbn("Correction Quantité");
    const mv = (await entry(isbnId, 100)).json();
    expect(await physical(isbnId, warehouseId)).toBe(100);

    // Le magasinier a tapé 100 au lieu de 60 → correction.
    const res = await app.inject({ method: "PATCH", url: `/api/v1/stock-movements/${mv.id}`, headers: { cookie }, payload: { quantity: 60, reason: "Correction : 60 exemplaires reçus" } });
    expect(res.statusCode).toBe(200);
    expect(await physical(isbnId, warehouseId)).toBe(60);

    const audit = await prisma.auditLog.findFirst({ where: { entityType: "stock_movement", entityId: mv.id, action: "update" } });
    expect(audit).not.toBeNull();
  });

  it("ANNULER un mouvement neutralise son effet et le passe au statut annulé", async () => {
    const isbnId = await newIsbn("Correction Annulation");
    const mv = (await entry(isbnId, 50)).json();
    expect(await physical(isbnId, warehouseId)).toBe(50);

    const res = await app.inject({ method: "POST", url: `/api/v1/stock-movements/${mv.id}/cancel`, headers: { cookie }, payload: { reason: "Saisie en double" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("cancelled");
    expect(await physical(isbnId, warehouseId)).toBe(0);

    // On ne réannule pas un mouvement déjà annulé.
    const again = await app.inject({ method: "POST", url: `/api/v1/stock-movements/${mv.id}/cancel`, headers: { cookie }, payload: {} });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("already_cancelled");
  });

  it("REFUSE de corriger un mouvement issu d'un autre document (référencé)", async () => {
    const isbnId = await newIsbn("Correction Système");
    const mv = (await entry(isbnId, 30, { reference_type: "goods_receipt", reference_id: "abc" })).json();
    const res = await app.inject({ method: "PATCH", url: `/api/v1/stock-movements/${mv.id}`, headers: { cookie }, payload: { quantity: 10 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("system_movement");
  });

  it("REFUSE une correction qui rendrait le stock négatif", async () => {
    const isbnId = await newIsbn("Correction Négatif");
    const mv = (await entry(isbnId, 100)).json();
    // 80 exemplaires sortent (vente comptoir enregistrée à part).
    await app.inject({ method: "POST", url: "/api/v1/stock-movements", headers: { cookie }, payload: { type: "sale_out", isbn_id: isbnId, print_run: 0, from_location_id: warehouseId, quantity: 80, reason: "Vente" } });
    expect(await physical(isbnId, warehouseId)).toBe(20);

    // Annuler l'entrée de 100 ferait tomber le stock à -80 → refus explicite.
    const res = await app.inject({ method: "POST", url: `/api/v1/stock-movements/${mv.id}/cancel`, headers: { cookie }, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("stock_negative");
    // Le stock reste inchangé après le refus.
    expect(await physical(isbnId, warehouseId)).toBe(20);
  });

  it("expose editable=true pour une saisie manuelle, false pour une référencée", async () => {
    const isbnId = await newIsbn("Correction Editable");
    const manual = (await entry(isbnId, 10)).json();
    const referenced = (await entry(isbnId, 5, { reference_type: "goods_receipt", reference_id: "z" })).json();
    const list = (await app.inject({ method: "GET", url: `/api/v1/stock-movements?isbn_id=${isbnId}`, headers: { cookie } })).json() as Array<{ id: string; editable: boolean }>;
    expect(list.find((m) => m.id === manual.id)?.editable).toBe(true);
    expect(list.find((m) => m.id === referenced.id)?.editable).toBe(false);
  });
});
