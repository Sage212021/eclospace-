import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie, uniqueIsbnPrefix } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(response.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("Commercial, distribution et ventes (Lot 4)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let genreId: string;
  let warehouseId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const genre = await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } });
    genreId = genre.id;
    await createUserWithRole("resp_commercial_test", "RESP_COMMERCIAL", "RespCommercial123!");

    const warehouse = await app.inject({
      method: "POST",
      url: "/api/v1/stock-locations",
      headers: { cookie: adminCookie },
      payload: { type: "entrepot", label: "Entrepôt commercial" },
    });
    warehouseId = warehouse.json().id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createIsbnWithStock(title: string, quantity: number) {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: { title, genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "Auteur", last_name: title } },
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
      await app.inject({ method: "PATCH", url: `/api/v1/contracts/${contract.id}/status`, headers: { cookie: adminCookie }, payload: { status } });
    }
    const pool = await app.inject({
      method: "POST",
      url: "/api/v1/isbn-pools",
      headers: { cookie: adminCookie },
      payload: { prefix: uniqueIsbnPrefix(1), digit_width: 1, range_start: 0, range_end: 9 },
    });
    const isbn = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/isbn`,
      headers: { cookie: adminCookie },
      payload: { format: "print", pool_id: pool.json().id },
    });
    const isbnId = isbn.json().id as string;

    if (quantity > 0) {
      await app.inject({
        method: "POST",
        url: "/api/v1/stock-movements",
        headers: { cookie: adminCookie },
        payload: { type: "production_in", isbn_id: isbnId, to_location_id: warehouseId, quantity, reason: "Réception fabrication" },
      });
    }

    return { manuscript, isbnId };
  }

  async function createCustomer(name: string, category = "librairie", creditLimit?: number) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/customers",
      headers: { cookie: adminCookie },
      payload: { category, name, credit_limit: creditLimit },
    });
    return response.json();
  }

  it("applique la remise de la grille par catégorie et réserve le stock à la confirmation (Ch. 17 §17.4-17.5)", async () => {
    const { isbnId } = await createIsbnWithStock("Manuscrit Commercial Remise", 100);
    const customer = await createCustomer("Librairie du Centre");

    const order = await app.inject({
      method: "POST",
      url: "/api/v1/sales-orders",
      headers: { cookie: adminCookie },
      payload: {
        customer_id: customer.id,
        channel: "telephone",
        location_id: warehouseId,
        lines: [{ isbn_id: isbnId, quantity: 10, unit_price: 10000 }],
      },
    });
    expect(order.statusCode).toBe(201);
    expect(order.json().status).toBe("confirmed");
    expect(Number(order.json().lines[0].discountPct)).toBe(35);
    expect(order.json().orderNumber).toMatch(/^CMD-\d{4}-\d{4}$/);

    const stockItem = await prisma.stockItem.findFirstOrThrow({ where: { isbnId, locationId: warehouseId } });
    expect(stockItem.quantityReserved).toBe(10);
    expect(stockItem.quantityPhysical).toBe(100);
  });

  it("refuse une commande dépassant le stock disponible (Ch. 17 §17.5 point 2)", async () => {
    const { isbnId } = await createIsbnWithStock("Manuscrit Commercial Rupture", 5);
    const customer = await createCustomer("Librairie Rupture");

    const order = await app.inject({
      method: "POST",
      url: "/api/v1/sales-orders",
      headers: { cookie: adminCookie },
      payload: {
        customer_id: customer.id,
        channel: "en_ligne",
        location_id: warehouseId,
        lines: [{ isbn_id: isbnId, quantity: 20, unit_price: 10000 }],
      },
    });
    expect(order.statusCode).toBe(409);
    expect(order.json().code).toBe("insufficient_stock");
  });

  it("bloque une commande dépassant le plafond d'encours puis la débloque via approbation (Ch. 17 §17.5 point 4)", async () => {
    const { isbnId } = await createIsbnWithStock("Manuscrit Commercial Encours", 1000);
    const customer = await createCustomer("Librairie Encours Limité", "librairie", 50000);

    const order = await app.inject({
      method: "POST",
      url: "/api/v1/sales-orders",
      headers: { cookie: adminCookie },
      payload: {
        customer_id: customer.id,
        channel: "salon",
        location_id: warehouseId,
        lines: [{ isbn_id: isbnId, quantity: 100, unit_price: 10000 }],
      },
    });
    expect(order.statusCode).toBe(201);
    expect(order.json().status).toBe("blocked_credit");

    const cookie = await loginCookie(app, "resp_commercial_test", "RespCommercial123!");
    const refused = await app.inject({
      method: "POST",
      url: `/api/v1/sales-orders/${order.json().id}/approve`,
      headers: { cookie },
      payload: {},
    });
    expect(refused.statusCode).toBe(403);

    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/sales-orders/${order.json().id}/approve`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe("confirmed");

    const stockItem = await prisma.stockItem.findFirstOrThrow({ where: { isbnId, locationId: warehouseId } });
    expect(stockItem.quantityReserved).toBe(0); // pas réservé tant que bloquée puis approuvée sans re-confirmation
  });

  it("une remise hors grille exige une validation de la direction commerciale (Ch. 17 §17.4)", async () => {
    const customer = await createCustomer("Librairie Remise Hors Grille");
    const cookie = await loginCookie(app, "resp_commercial_test", "RespCommercial123!");

    const refused = await app.inject({
      method: "POST",
      url: `/api/v1/customers/${customer.id}/discounts`,
      headers: { cookie },
      payload: { discount_pct: 60, label: "Salon rentrée scolaire" },
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe("off_grid_discount_requires_approval");

    const withinGrid = await app.inject({
      method: "POST",
      url: `/api/v1/customers/${customer.id}/discounts`,
      headers: { cookie },
      payload: { discount_pct: 30 },
    });
    expect(withinGrid.statusCode).toBe(201);
  });

  it("livre une commande et rapproche automatiquement le stock (Ch. 17 §17.8, Ch. 16 §16.6)", async () => {
    const { isbnId } = await createIsbnWithStock("Manuscrit Commercial Livraison", 50);
    const customer = await createCustomer("Librairie Livraison");
    const order = await app.inject({
      method: "POST",
      url: "/api/v1/sales-orders",
      headers: { cookie: adminCookie },
      payload: { customer_id: customer.id, channel: "comptoir", location_id: warehouseId, lines: [{ isbn_id: isbnId, quantity: 10, unit_price: 10000 }] },
    });

    const delivery = await app.inject({
      method: "POST",
      url: `/api/v1/sales-orders/${order.json().id}/deliveries`,
      headers: { cookie: adminCookie },
      payload: { carrier: "Transporteur local", lines: [{ isbn_id: isbnId, quantity: 10 }] },
    });
    expect(delivery.statusCode).toBe(201);
    expect(delivery.json().deliveryNumber).toMatch(/^BL-\d{4}-\d{4}$/);

    const stockItem = await prisma.stockItem.findFirstOrThrow({ where: { isbnId, locationId: warehouseId } });
    expect(stockItem.quantityPhysical).toBe(40);
    expect(stockItem.quantityReserved).toBe(0);

    const orderAfter = await app.inject({ method: "GET", url: `/api/v1/sales-orders/${order.json().id}`, headers: { cookie: adminCookie } });
    expect(orderAfter.json().status).toBe("shipped");

    const confirmed = await app.inject({ method: "PATCH", url: `/api/v1/deliveries/${delivery.json().id}/confirm`, headers: { cookie: adminCookie }, payload: {} });
    expect(confirmed.statusCode).toBe(200);
    const orderDelivered = await app.inject({ method: "GET", url: `/api/v1/sales-orders/${order.json().id}`, headers: { cookie: adminCookie } });
    expect(orderDelivered.json().status).toBe("delivered");
  });

  it("gère un dépôt-vente : mise en dépôt puis relevé de ventes réduisant le stock déposé (Ch. 17 §17.6)", async () => {
    const { isbnId } = await createIsbnWithStock("Manuscrit Commercial Depot Vente", 60);
    const customer = await createCustomer("Librairie Dépôt-Vente", "librairie");

    const depotLocation = await app.inject({
      method: "POST",
      url: "/api/v1/stock-locations",
      headers: { cookie: adminCookie },
      payload: { type: "depot_vente", label: "Dépôt chez Librairie Dépôt-Vente", customer_id: customer.id },
    });

    const consignment = await app.inject({
      method: "POST",
      url: "/api/v1/consignments",
      headers: { cookie: adminCookie },
      payload: { customer_id: customer.id, location_id: depotLocation.json().id, isbn_id: isbnId, quantity_deposited: 20 },
    });
    expect(consignment.statusCode).toBe(201);

    const depotStock = await prisma.stockItem.findFirstOrThrow({ where: { isbnId, locationId: depotLocation.json().id } });
    expect(depotStock.quantityPhysical).toBe(20);

    const statement = await app.inject({
      method: "POST",
      url: `/api/v1/consignments/${consignment.json().id}/statements`,
      headers: { cookie: adminCookie },
      payload: { period_start: "2026-07-01T00:00:00.000Z", period_end: "2026-07-31T00:00:00.000Z", quantity_sold: 8 },
    });
    expect(statement.statusCode).toBe(201);

    const depotStockAfter = await prisma.stockItem.findFirstOrThrow({ where: { isbnId, locationId: depotLocation.json().id } });
    expect(depotStockAfter.quantityPhysical).toBe(12);

    const validated = await app.inject({
      method: "PATCH",
      url: `/api/v1/consignment-statements/${statement.json().id}/validate`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(validated.statusCode).toBe(200);
    expect(validated.json().validatedAt).not.toBeNull();
  });

  it("vend au comptoir avec paiement mobile money et déduit le stock immédiatement (Ch. 17 §17.7)", async () => {
    const { isbnId } = await createIsbnWithStock("Manuscrit Commercial Comptoir", 30);

    const sale = await app.inject({
      method: "POST",
      url: "/api/v1/pos-sales",
      headers: { cookie: adminCookie },
      payload: { isbn_id: isbnId, location_id: warehouseId, quantity: 3, unit_price: 12000, payment_method: "mobile_money", event_label: "Salon du livre" },
    });
    expect(sale.statusCode).toBe(201);

    const stockItem = await prisma.stockItem.findFirstOrThrow({ where: { isbnId, locationId: warehouseId } });
    expect(stockItem.quantityPhysical).toBe(27);
  });

  it("gère un retour client avec verdict par exemplaire (Ch. 17 §17.9)", async () => {
    const { isbnId } = await createIsbnWithStock("Manuscrit Commercial Retour", 20);
    const customer = await createCustomer("Librairie Retour");

    const customerReturn = await app.inject({
      method: "POST",
      url: "/api/v1/customer-returns",
      headers: { cookie: adminCookie },
      payload: { customer_id: customer.id },
    });
    expect(customerReturn.statusCode).toBe(201);

    const received = await app.inject({
      method: "POST",
      url: `/api/v1/customer-returns/${customerReturn.json().id}/receive`,
      headers: { cookie: adminCookie },
      payload: {
        lines: [
          { isbn_id: isbnId, quantity: 5, verdict: "resaleable", location_id: warehouseId },
          { isbn_id: isbnId, quantity: 2, verdict: "pulp", location_id: warehouseId },
          { isbn_id: isbnId, quantity: 1, verdict: "damaged", location_id: warehouseId },
        ],
      },
    });
    expect(received.statusCode).toBe(200);
    expect(received.json().receivedAt).not.toBeNull();

    const vendableStock = await prisma.stockItem.findFirstOrThrow({ where: { isbnId, locationId: warehouseId, condition: "vendable" } });
    // 20 initial + 5 remis en stock vendable ; le pilon retire d'un stock déjà
    // sorti (rien à en retrancher ici) ; le déclassé va dans un compartiment séparé.
    expect(vendableStock.quantityPhysical).toBe(25);

    const declasseStock = await prisma.stockItem.findFirstOrThrow({ where: { isbnId, locationId: warehouseId, condition: "declasse" } });
    expect(declasseStock.quantityPhysical).toBe(1);
  });

  it("un rôle sans permission commercial:saisie ne peut pas créer de commande", async () => {
    const { isbnId } = await createIsbnWithStock("Manuscrit Commercial Permissions", 10);
    const customer = await createCustomer("Librairie Permissions");
    await createUserWithRole("correcteur_commande_test", "CORRECTEUR", "Correcteur123!");
    const cookie = await loginCookie(app, "correcteur_commande_test", "Correcteur123!");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/sales-orders",
      headers: { cookie },
      payload: { customer_id: customer.id, channel: "telephone", location_id: warehouseId, lines: [{ isbn_id: isbnId, quantity: 1, unit_price: 5000 }] },
    });
    expect(response.statusCode).toBe(403);
  });
});
