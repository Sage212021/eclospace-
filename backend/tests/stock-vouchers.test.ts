import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Pièces du pôle Stock & magasin (revue opérateur du 27/08/2026) : Bon de
// réception de livres + Retrait d'ouvrage auteur. Documents numérotés, tracés,
// réimprimables ; ils n'affectent PAS les stocks.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("pièces stock & magasin (bon de réception + retrait auteur)", () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    cookie = await loginCookie(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("bon de réception : création numérotée, lignes, édition, suppression logique, sans impact stock", async () => {
    const stockBefore = await prisma.stockMovement.count();

    const create = await app.inject({
      method: "POST", url: "/api/v1/book-receipts", headers: { cookie },
      payload: {
        received_at: "2026-08-26T00:00:00.000Z", supplier: "GLC SARL", order_number: "0081", delivery_note: "0063", carrier: "GLC SARL",
        received_by_name: "NDI SANAMA", received_by_role: "Responsable logistique et des stocks",
        remarks: "177 exemplaires endommagés par leur encollage.",
        lines: [
          { title: "Les clés d'une retraite épanouie", author: "Olga Lona", qty_ordered: 400, qty_received: 400, qty_good: 223, qty_damaged: 177 },
          { title: "Et dieu de plus en plus haut", author: "Emile Kwegueng", qty_received: 30, qty_good: 20, qty_damaged: 10 },
        ],
      },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().number).toMatch(/^BR-\d{4}-\d{4}$/);
    expect(create.json().lines).toHaveLength(2);
    const firstSeq = Number(create.json().number.slice(-4));

    // Numérotation continue (la pièce initiale du seed occupe déjà 0001).
    const second = await app.inject({ method: "POST", url: "/api/v1/book-receipts", headers: { cookie }, payload: { received_at: "2026-08-27T00:00:00.000Z", lines: [{ title: "Autre" }] } });
    expect(Number(second.json().number.slice(-4))).toBe(firstSeq + 1);

    const id = create.json().id;
    // Édition : change le fournisseur et remplace les lignes.
    const edit = await app.inject({ method: "PUT", url: `/api/v1/book-receipts/${id}`, headers: { cookie }, payload: { received_at: "2026-08-26T00:00:00.000Z", supplier: "GLC SARL (corrigé)", lines: [{ title: "Une seule ligne", qty_received: 5 }] } });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().supplier).toBe("GLC SARL (corrigé)");
    expect(edit.json().lines).toHaveLength(1);
    expect(edit.json().number).toBe(create.json().number); // numéro conservé

    // Aucune écriture de stock créée par ces documents.
    expect(await prisma.stockMovement.count()).toBe(stockBefore);

    const del = await app.inject({ method: "DELETE", url: `/api/v1/book-receipts/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/api/v1/book-receipts", headers: { cookie } });
    expect(list.json().some((v: { id: string }) => v.id === id)).toBe(false);
  });

  it("retrait d'ouvrage auteur : création numérotée, motif « autre » exige un détail", async () => {
    const create = await app.inject({
      method: "POST", url: "/api/v1/author-withdrawals", headers: { cookie },
      payload: { issued_at: "2026-08-27T00:00:00.000Z", place: "Yaoundé", author_name: "Zang Zang Elie Denis", author_phone: "656 09 78 07", work_title: "Paternité charnelle", quantity: 15, motive: "restitution_stock" },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().number).toMatch(/^RA-\d{4}-\d{4}$/);
    expect(create.json().quantity).toBe(15);

    // Motif « autre » sans précision : refusé.
    const bad = await app.inject({ method: "POST", url: "/api/v1/author-withdrawals", headers: { cookie }, payload: { issued_at: "2026-08-27T00:00:00.000Z", author_name: "X", work_title: "Y", quantity: 1, motive: "autre" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("motive_other_required");

    // Motif « autre » avec précision : accepté.
    const ok = await app.inject({ method: "POST", url: "/api/v1/author-withdrawals", headers: { cookie }, payload: { issued_at: "2026-08-27T00:00:00.000Z", author_name: "X", work_title: "Y", quantity: 1, motive: "autre", motive_other: "Don pour salon du livre" } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().motiveOther).toBe("Don pour salon du livre");

    const id = create.json().id;
    const del = await app.inject({ method: "DELETE", url: `/api/v1/author-withdrawals/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);
    const one = await app.inject({ method: "GET", url: `/api/v1/author-withdrawals/${id}`, headers: { cookie } });
    expect(one.statusCode).toBe(404);
  });

  it("bon de commande : création numérotée (BC), lignes + spécifications, édition, suppression logique, sans impact stock", async () => {
    const stockBefore = await prisma.stockMovement.count();

    const create = await app.inject({
      method: "POST", url: "/api/v1/purchase-order-vouchers", headers: { cookie },
      payload: {
        ordered_at: "2026-10-15T00:00:00.000Z", supplier: "Imprimerie Saint-Paul", supplier_address: "Yaoundé", supplier_contact: "699 00 00 00",
        quote_ref: "DEV-2026-012", delivery_place: "Entrepôt principal", delivery_due: "2026-11-15T00:00:00.000Z",
        payment_terms: "50 % à la commande, solde à la livraison", tax_rate: 0, issued_by_name: "NDI SANAMA", issued_by_role: "Responsable des stocks",
        lines: [
          { designation: "Le Roi Mbella", specs: "14x21, 200 p., offset 80g, broché, couv. couché 250g pelliculé mat", quantity: 1000, unit_price_ht: 1200 },
          { designation: "Vers amers", specs: "14x21, 90 p.", quantity: 500, unit_price_ht: 900 },
        ],
      },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().number).toMatch(/^BC-\d{4}-\d{4}$/);
    expect(create.json().lines).toHaveLength(2);
    expect(create.json().lines[0].specs).toContain("pelliculé");
    const firstSeq = Number(create.json().number.slice(-4));

    // Numérotation continue.
    const second = await app.inject({ method: "POST", url: "/api/v1/purchase-order-vouchers", headers: { cookie }, payload: { ordered_at: "2026-10-16T00:00:00.000Z", supplier: "Autre imprimeur", lines: [{ designation: "X", quantity: 10, unit_price_ht: 100 }] } });
    expect(Number(second.json().number.slice(-4))).toBe(firstSeq + 1);

    // Fournisseur obligatoire.
    const noSupplier = await app.inject({ method: "POST", url: "/api/v1/purchase-order-vouchers", headers: { cookie }, payload: { ordered_at: "2026-10-16T00:00:00.000Z", supplier: "", lines: [{ designation: "X", quantity: 1, unit_price_ht: 1 }] } });
    expect(noSupplier.statusCode).toBe(400);

    const id = create.json().id;
    const edit = await app.inject({ method: "PUT", url: `/api/v1/purchase-order-vouchers/${id}`, headers: { cookie }, payload: { ordered_at: "2026-10-15T00:00:00.000Z", supplier: "Imprimerie Saint-Paul (corrigé)", tax_rate: 19.25, lines: [{ designation: "Une seule ligne", quantity: 100, unit_price_ht: 500 }] } });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().supplier).toBe("Imprimerie Saint-Paul (corrigé)");
    expect(edit.json().lines).toHaveLength(1);
    expect(edit.json().number).toBe(create.json().number); // numéro conservé

    // Aucune écriture de stock.
    expect(await prisma.stockMovement.count()).toBe(stockBefore);

    const del = await app.inject({ method: "DELETE", url: `/api/v1/purchase-order-vouchers/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/api/v1/purchase-order-vouchers", headers: { cookie } });
    expect(list.json().some((v: { id: string }) => v.id === id)).toBe(false);
  });
});
