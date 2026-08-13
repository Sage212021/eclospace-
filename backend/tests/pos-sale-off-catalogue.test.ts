import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Vente au comptoir HORS CATALOGUE (livre non encore référencé) : enregistrée
// comme provisoire — pas de mouvement de stock, pas de facture — et client
// optionnel (au choix du commercial).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("vente au comptoir hors catalogue", () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("enregistre une vente hors catalogue (provisoire) sans toucher le stock ni facturer", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/pos-sales",
      headers: { cookie },
      payload: { off_catalogue_title: "Une nouveauté non cataloguée", off_catalogue_author: "A. Nonyme", quantity: 2, unit_price: 5000, payment_method: "cash" },
    });
    expect(res.statusCode).toBe(201);
    const sale = res.json();
    expect(sale.isbnId).toBeNull();
    expect(sale.offCatalogueTitle).toBe("Une nouveauté non cataloguée");

    // Aucune facture ni mouvement de stock rattaché à cette vente provisoire.
    const inv = await prisma.invoice.findFirst({ where: { sourceType: "pos_sale", sourceId: sale.id } });
    expect(inv).toBeNull();
    const mv = await prisma.stockMovement.findFirst({ where: { referenceType: "pos_sale", referenceId: sale.id } });
    expect(mv).toBeNull();
  });

  it("rattache un client optionnel s'il est fourni", async () => {
    const customer = await prisma.customer.create({ data: { category: "librairie", name: `Cli ${rnd()}` } });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/pos-sales",
      headers: { cookie },
      payload: { off_catalogue_title: "Autre livre", quantity: 1, unit_price: 3000, payment_method: "cash", customer_id: customer.id },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().customerId).toBe(customer.id);
  });

  it("refuse une vente sans ISBN ni titre hors catalogue (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/pos-sales",
      headers: { cookie },
      payload: { quantity: 1, unit_price: 3000, payment_method: "cash" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("liste les ventes provisoires (à rattacher) via provisional=true", async () => {
    const create = await app.inject({ method: "POST", url: "/api/v1/pos-sales", headers: { cookie }, payload: { off_catalogue_title: `Prov ${rnd()}`, quantity: 1, unit_price: 4000, payment_method: "cash" } });
    const id = create.json().id as string;
    const list = await app.inject({ method: "GET", url: "/api/v1/pos-sales?provisional=true", headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const ids = (list.json() as { id: string; is_catalogue: boolean }[]).map((s) => s.id);
    expect(ids).toContain(id);
    // provisional=true ne renvoie que des ventes hors catalogue.
    expect((list.json() as { is_catalogue: boolean }[]).every((s) => s.is_catalogue === false)).toBe(true);
  });

  it("réconciliation : 404 sur une vente inexistante", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/pos-sales/00000000-0000-0000-0000-000000000000/reconcile", headers: { cookie }, payload: { isbn_id: "00000000-0000-0000-0000-000000000001" } });
    expect(res.statusCode).toBe(404);
  });

  it("réconciliation : 404 si l'ISBN cible n'existe pas", async () => {
    const create = await app.inject({ method: "POST", url: "/api/v1/pos-sales", headers: { cookie }, payload: { off_catalogue_title: `Prov ${rnd()}`, quantity: 1, unit_price: 4000, payment_method: "cash" } });
    const id = create.json().id as string;
    const res = await app.inject({ method: "POST", url: `/api/v1/pos-sales/${id}/reconcile`, headers: { cookie }, payload: { isbn_id: "00000000-0000-0000-0000-000000000002" } });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("isbn_not_found");
  });
});
