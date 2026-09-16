import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie, uniqueIsbnPrefix } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Cycle de réapprovisionnement (D-038) : demande → validé → réception (partielle
// puis totale). Règle 5 : le stock N'AUGMENTE QU'À LA RÉCEPTION.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("Réapprovisionnement — cycle demande → réception (D-038)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let genreId: string;
  let warehouseId: string;
  let isbnId: string;

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };
  const availableAt = async () => {
    const it = await prisma.stockItem.findFirst({ where: { isbnId, locationId: warehouseId, condition: "vendable" } });
    return it ? it.quantityPhysical - it.quantityReserved : 0;
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

  beforeAll(async () => {
    app = await buildApp();
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    cookie = await login("admin", ADMIN_PASSWORD);
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
    warehouseId = (await app.inject({ method: "POST", url: "/api/v1/stock-locations", headers: { cookie }, payload: { type: "entrepot", label: "Entrepôt réappro" } })).json().id;
    isbnId = await newIsbn("Réappro Test");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("cycle complet : demande → validé → réceptions partielle puis totale, stock à la réception seulement", async () => {
    expect(await availableAt()).toBe(0);

    // Demande de 500 : le stock ne bouge PAS (Règle 5).
    const created = await app.inject({ method: "POST", url: "/api/v1/replenishments", headers: { cookie }, payload: { isbn_id: isbnId, location_id: warehouseId, quantity_requested: 500, supplier: "Imprimeur X", unit_cost: 100, order_ref: "CMD-2026-001" } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(created.json().status).toBe("requested");
    expect(created.json().total_cost).toBe(50000);
    expect(await availableAt()).toBe(0);

    // Validation → approved (toujours pas de stock).
    const appr = await app.inject({ method: "PATCH", url: `/api/v1/replenishments/${id}/approve`, headers: { cookie }, payload: {} });
    expect(appr.statusCode).toBe(200);
    expect(appr.json().status).toBe("approved");
    expect(await availableAt()).toBe(0);

    // Réception partielle de 300 → partially_received, stock = 300.
    const r1 = await app.inject({ method: "PATCH", url: `/api/v1/replenishments/${id}/receive`, headers: { cookie }, payload: { quantity: 300, receipt_ref: "BL-01" } });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().status).toBe("partially_received");
    expect(r1.json().remaining).toBe(200);
    expect(await availableAt()).toBe(300);

    // Sur-réception refusée (il ne reste que 200).
    const over = await app.inject({ method: "PATCH", url: `/api/v1/replenishments/${id}/receive`, headers: { cookie }, payload: { quantity: 250 } });
    expect(over.statusCode).toBe(409);
    expect(over.json().code).toBe("over_reception");

    // Réception du reste (200) → received, stock = 500.
    const r2 = await app.inject({ method: "PATCH", url: `/api/v1/replenishments/${id}/receive`, headers: { cookie }, payload: { quantity: 200, receipt_ref: "BL-02" } });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().status).toBe("received");
    expect(await availableAt()).toBe(500);

    // Une demande clôturée ne peut plus être réceptionnée.
    const again = await app.inject({ method: "PATCH", url: `/api/v1/replenishments/${id}/receive`, headers: { cookie }, payload: { quantity: 10 } });
    expect(again.statusCode).toBe(409);

    // Un mouvement d'entrée « supplier_in » a bien été créé, rattaché à la demande.
    const moves = await prisma.stockMovement.findMany({ where: { isbnId, type: "supplier_in", referenceType: "replenishment", referenceId: id } });
    expect(moves.reduce((s, m) => s + m.quantity, 0)).toBe(500);
  });

  it("annulation d'une demande non reçue", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/replenishments", headers: { cookie }, payload: { isbn_id: isbnId, location_id: warehouseId, quantity_requested: 50 } });
    const id = created.json().id as string;
    const c = await app.inject({ method: "PATCH", url: `/api/v1/replenishments/${id}/cancel`, headers: { cookie }, payload: { reason: "Erreur de saisie" } });
    expect(c.statusCode).toBe(200);
    expect(c.json().status).toBe("cancelled");
  });

  it("un rôle en simple consultation ne peut pas créer de demande (403)", async () => {
    await createUserWithRole("resp_commercial_reap", "RESP_COMMERCIAL", "RespCommercial123!");
    const roCookie = await login("resp_commercial_reap", "RespCommercial123!");
    const res = await app.inject({ method: "POST", url: "/api/v1/replenishments", headers: { cookie: roCookie }, payload: { isbn_id: isbnId, location_id: warehouseId, quantity_requested: 10 } });
    expect(res.statusCode).toBe(403);
  });
});
