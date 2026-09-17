import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Tableau récapitulatif du stock par ouvrage (cahier §4, §18, §37). Tous les
// chiffres se calculent depuis les données réelles (mouvements, items, dépôts,
// transit). On vérifie : flux, état, dépôt, transit, politique (seuils/cible),
// statut à 4 niveaux, quantité à réapprovisionner, et la cohérence
// « stock affiché = somme des items (donc des mouvements) » (§37).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("Stock — tableau récapitulatif par ouvrage (§4/§18)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let isbnId: string;
  let entrepotId: string;
  const s = Math.random().toString(36).slice(2, 7);

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };
  const overviewRow = async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/stock/overview", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    return (r.json().rows as Array<Record<string, number | string>>).find((x) => x.isbn_id === isbnId)!;
  };

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login("admin", ADMIN_PASSWORD);
    // Ouvrage au catalogue central (via l'ajout rapide) → un ISBN.
    const good = await app.inject({ method: "POST", url: "/api/v1/commercial-stock/quick-good", headers: { cookie }, payload: { title: `Ouvrage récap ${s}` } });
    isbnId = good.json().id;
    // Un entrepôt.
    entrepotId = (await app.inject({ method: "POST", url: "/api/v1/stock-locations", headers: { cookie }, payload: { type: "entrepot", label: `Magasin récap ${s}` } })).json().id;
    // Tirage initial : +500 en entrée.
    await app.inject({ method: "POST", url: "/api/v1/stock-movements", headers: { cookie }, payload: { type: "production_in", isbn_id: isbnId, print_run: 0, to_location_id: entrepotId, quantity: 500, reason: "Tirage initial" } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("calcule les flux et l'état réel (entrées, physique, disponible)", async () => {
    const row = await overviewRow();
    expect(row.entrees).toBe(500);
    expect(row.stock_physique).toBe(500);
    expect(row.disponible).toBe(500);
    expect(row.statut).toBe("normal"); // pas de politique encore, seuil défaut bas
  });

  it("applique la politique par ouvrage : statut à 4 niveaux et quantité à réapprovisionner", async () => {
    // Seuils : alerte 100, réappro 75, cible 500, réimpression mini 250.
    const put = await app.inject({ method: "PUT", url: `/api/v1/stock/policy/${isbnId}`, headers: { cookie }, payload: { alert_threshold: 100, reorder_threshold: 75, target_stock: 500, min_reprint_qty: 250 } });
    expect(put.statusCode).toBe(200);

    // Vente de 450 → disponible 50 (≤ seuil de réappro 75).
    await app.inject({ method: "POST", url: "/api/v1/stock-movements", headers: { cookie }, payload: { type: "sale_out", isbn_id: isbnId, print_run: 0, from_location_id: entrepotId, quantity: 450, reason: "Ventes" } });

    const row = await overviewRow();
    expect(row.disponible).toBe(50);
    expect(row.sorties).toBe(450);
    expect(row.statut).toBe("reappro");
    // Cible 500 − dispo 50 = 450, et ≥ réimpression mini 250 → 450.
    expect(row.qte_a_reapprovisionner).toBe(450);
    expect(row.seuil_alerte).toBe(100);
    expect(row.stock_cible).toBe(500);
  });

  it("compte le stock EN DÉPÔT (consignations) et EN TRANSIT (livraisons expédiées non reçues)", async () => {
    // Dépôt : 20 exemplaires chez un libraire (consignation active).
    const customer = await prisma.customer.create({ data: { category: "librairie", name: `Libraire ${s}` } });
    await prisma.consignment.create({ data: { customerId: customer.id, isbnId, quantityDeposited: 20, status: "active" } });
    // Transit : une livraison expédiée mais pas encore réceptionnée (30 ex.).
    const order = await prisma.salesOrder.create({ data: { customerId: customer.id, orderNumber: `CMD-${s}`, channel: "comptoir" } });
    const delivery = await prisma.delivery.create({ data: { orderId: order.id, deliveryNumber: `BL-${s}`, shippedAt: new Date(), deliveredAt: null } });
    await prisma.deliveryLine.create({ data: { deliveryId: delivery.id, isbnId, quantity: 30 } });

    const row = await overviewRow();
    expect(row.en_depot).toBe(20);
    expect(row.en_transit).toBe(30);
  });

  it("cohérence (§37) : le stock physique affiché = somme réelle des items (issus des mouvements)", async () => {
    const items = await prisma.stockItem.findMany({ where: { isbnId, condition: { in: ["vendable", "declasse"] } }, select: { quantityPhysical: true } });
    const sumItems = items.reduce((s2, it) => s2 + it.quantityPhysical, 0);
    const row = await overviewRow();
    expect(row.stock_physique).toBe(sumItems);
    expect(sumItems).toBe(50); // 500 tirage − 450 ventes
  });

  it("refuse un seuil de réappro supérieur au seuil d'alerte (cohérence)", async () => {
    const r = await app.inject({ method: "PUT", url: `/api/v1/stock/policy/${isbnId}`, headers: { cookie }, payload: { alert_threshold: 100, reorder_threshold: 200 } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("threshold_order");
  });

  it("rotation (Lot C) : cadence de vente, couverture et réappro conseillé explicable", async () => {
    // À ce stade : 450 vendus (récents), disponible 50, en transit 30, cible 500,
    // réimpression mini 250, pas de délai réglé (→ 1 mois) + marge 2 mois.
    const row = await overviewRow();
    expect(row.ventes_3m).toBe(450);
    expect(row.ventes_par_mois).toBe(150); // 450 / 3 mois
    expect(row.couverture_mois).toBe(0.3); // 50 dispo / 150 par mois
    // besoin = 150 × (1 + 2) = 450 ; − 50 dispo − 30 transit = 370 (≥ 250 mini).
    expect(row.reappro_conseille).toBe(370);
    expect(String(row.reappro_explication)).toMatch(/Ventes/);
  });
});
