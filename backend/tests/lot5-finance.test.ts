import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie, uniqueIsbnPrefix } from "./helpers.js";
import { periodKeyFor } from "../src/lib/accountingPeriod.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(response.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("Finance et droits d'auteur (Lot 5)", () => {
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

    const warehouse = await app.inject({
      method: "POST",
      url: "/api/v1/stock-locations",
      headers: { cookie: adminCookie },
      payload: { type: "entrepot", label: "Entrepôt finance" },
    });
    warehouseId = warehouse.json().id;

    // Ch. 18 §18.9 : taux de TVA par défaut, requis pour des totaux de
    // facture non nuls dans les tests qui suivent.
    await app.inject({
      method: "POST",
      url: "/api/v1/tax-rates",
      headers: { cookie: adminCookie },
      payload: { country: "default", product_type: "livre", rate: 18 },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createIsbnWithContractAndStock(
    title: string,
    quantity: number,
    financialTerms: Record<string, unknown> = {},
  ) {
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
      payload: { type: "edition", manuscript_id: manuscript.id, partner_id: partnerId, financial_terms: financialTerms },
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

    return { manuscript, isbnId, contractId: contract.id as string };
  }

  async function createCustomer(name: string, category = "particulier", creditLimit?: number, shippingZone?: string) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/customers",
      headers: { cookie: adminCookie },
      payload: { category, name, credit_limit: creditLimit, shipping_zone: shippingZone },
    });
    return response.json();
  }

  async function deliverOrder(isbnId: string, customerId: string, quantity: number, unitPrice: number) {
    const order = await app.inject({
      method: "POST",
      url: "/api/v1/sales-orders",
      headers: { cookie: adminCookie },
      payload: { customer_id: customerId, channel: "telephone", location_id: warehouseId, lines: [{ isbn_id: isbnId, quantity, unit_price: unitPrice }] },
    });
    const delivery = await app.inject({
      method: "POST",
      url: `/api/v1/sales-orders/${order.json().id}/deliveries`,
      headers: { cookie: adminCookie },
      payload: { carrier: "Transporteur", lines: [{ isbn_id: isbnId, quantity }] },
    });
    return { order: order.json(), delivery: delivery.json() };
  }

  it("génère automatiquement une facture depuis une livraison avec TVA calculée (Ch. 18 §18.2, §18.9)", async () => {
    const { isbnId } = await createIsbnWithContractAndStock("Manuscrit Finance Facture", 50);
    const customer = await createCustomer("Client Facture");

    const { delivery } = await deliverOrder(isbnId, customer.id, 10, 10000);
    expect(delivery.deliveryNumber).toMatch(/^BL-\d{4}-\d{4}$/);

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { sourceType: "delivery", sourceId: delivery.id } });
    expect(invoice.invoiceNumber).toMatch(/^FA-\d{4}-\d{5}$/);
    expect(Number(invoice.totalHt)).toBe(100000);
    expect(Number(invoice.totalTax)).toBe(18000);
    expect(Number(invoice.totalTtc)).toBe(118000);
    expect(invoice.status).toBe("issued");
  });

  it("applique un forfait de frais de port sur la première livraison seulement (Ch. 17 §17.5)", async () => {
    const shippingRate = await app.inject({
      method: "POST",
      url: "/api/v1/shipping-rates",
      headers: { cookie: adminCookie },
      payload: { zone: "douala", flat_amount: 2000 },
    });
    expect(shippingRate.statusCode).toBe(201);

    const { isbnId } = await createIsbnWithContractAndStock("Manuscrit Finance Frais Port", 50);
    const customer = await createCustomer("Client Frais Port Douala", "particulier", undefined, "douala");

    const order = await app.inject({
      method: "POST",
      url: "/api/v1/sales-orders",
      headers: { cookie: adminCookie },
      payload: { customer_id: customer.id, channel: "telephone", location_id: warehouseId, lines: [{ isbn_id: isbnId, quantity: 10, unit_price: 10000 }] },
    });
    expect(Number(order.json().shippingFee)).toBe(2000);

    const firstDelivery = await app.inject({
      method: "POST",
      url: `/api/v1/sales-orders/${order.json().id}/deliveries`,
      headers: { cookie: adminCookie },
      payload: { carrier: "Transporteur", lines: [{ isbn_id: isbnId, quantity: 6 }] },
    });
    const firstInvoice = await prisma.invoice.findFirstOrThrow({ where: { sourceType: "delivery", sourceId: firstDelivery.json().id }, include: { lines: true } });
    expect(firstInvoice.lines.some((l) => l.description === "Frais de port" && Number(l.unitPrice) === 2000)).toBe(true);

    const secondDelivery = await app.inject({
      method: "POST",
      url: `/api/v1/sales-orders/${order.json().id}/deliveries`,
      headers: { cookie: adminCookie },
      payload: { carrier: "Transporteur", lines: [{ isbn_id: isbnId, quantity: 4 }] },
    });
    const secondInvoice = await prisma.invoice.findFirstOrThrow({ where: { sourceType: "delivery", sourceId: secondDelivery.json().id }, include: { lines: true } });
    expect(secondInvoice.lines.some((l) => l.description === "Frais de port")).toBe(false);
  });

  it("applique la gratuité des frais de port au-delà d'un seuil de commande (Ch. 17 §17.5)", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/shipping-rates",
      headers: { cookie: adminCookie },
      payload: { zone: "yaounde", flat_amount: 1500, free_above_amount: 50000 },
    });

    const { isbnId } = await createIsbnWithContractAndStock("Manuscrit Finance Port Gratuit", 50);
    const customer = await createCustomer("Client Port Gratuit Yaoundé", "particulier", undefined, "yaounde");

    const order = await app.inject({
      method: "POST",
      url: "/api/v1/sales-orders",
      headers: { cookie: adminCookie },
      payload: { customer_id: customer.id, channel: "telephone", location_id: warehouseId, lines: [{ isbn_id: isbnId, quantity: 10, unit_price: 10000 }] },
    });
    expect(Number(order.json().shippingFee)).toBe(0); // 100000 >= seuil de gratuité de 50000
  });

  it("un encaissement lettré réduit l'encours client (Ch. 18 §18.3)", async () => {
    const { isbnId } = await createIsbnWithContractAndStock("Manuscrit Finance Encaissement", 20);
    const customer = await createCustomer("Client Encaissement");
    const { delivery } = await deliverOrder(isbnId, customer.id, 5, 10000);
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { sourceType: "delivery", sourceId: delivery.id } });

    const before = await app.inject({ method: "GET", url: `/api/v1/customers/${customer.id}`, headers: { cookie: adminCookie } });
    expect(before.json().outstandingBalance).toBe(Number(invoice.totalTtc));

    const payment = await app.inject({
      method: "POST",
      url: "/api/v1/payments",
      headers: { cookie: adminCookie },
      payload: {
        method: "transfer",
        amount: Number(invoice.totalTtc) / 2,
        allocations: [{ invoice_id: invoice.id, amount: Number(invoice.totalTtc) / 2 }],
      },
    });
    expect(payment.statusCode).toBe(201);

    const after = await app.inject({ method: "GET", url: `/api/v1/customers/${customer.id}`, headers: { cookie: adminCookie } });
    expect(after.json().outstandingBalance).toBe(Number(invoice.totalTtc) / 2);

    const aging = await app.inject({ method: "GET", url: `/api/v1/customers/${customer.id}/aging`, headers: { cookie: adminCookie } });
    expect(aging.json().not_due).toBe(Number(invoice.totalTtc) / 2);
  });

  it("passe la facture à « Réglée » quand le solde atteint 0 (encaissement complet)", async () => {
    const { isbnId } = await createIsbnWithContractAndStock("Manuscrit Finance Soldée", 20);
    const customer = await createCustomer("Client Soldée");
    const { delivery } = await deliverOrder(isbnId, customer.id, 5, 10000);
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { sourceType: "delivery", sourceId: delivery.id } });
    const ttc = Number(invoice.totalTtc);
    expect(invoice.status).toBe("issued");

    // Paiement partiel (moitié) : la facture reste « Émise ».
    const p1 = await app.inject({
      method: "POST",
      url: "/api/v1/payments",
      headers: { cookie: adminCookie },
      payload: { method: "cash", amount: ttc / 2, allocations: [{ invoice_id: invoice.id, amount: ttc / 2 }] },
    });
    expect(p1.statusCode).toBe(201);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("issued");

    // Solde réglé : la facture bascule automatiquement sur « Réglée » (paid).
    const p2 = await app.inject({
      method: "POST",
      url: "/api/v1/payments",
      headers: { cookie: adminCookie },
      payload: { method: "cash", amount: ttc / 2, allocations: [{ invoice_id: invoice.id, amount: ttc / 2 }] },
    });
    expect(p2.statusCode).toBe(201);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("paid");

    // Traçabilité : le changement de statut est journalisé (audit_log).
    const audit = await prisma.auditLog.findFirst({ where: { entityType: "invoice", entityId: invoice.id, action: "update" } });
    expect(audit).not.toBeNull();
  });

  it("refuse un lettrage dont le total ne correspond pas au montant du paiement (Ch. 18 §18.3)", async () => {
    const { isbnId } = await createIsbnWithContractAndStock("Manuscrit Finance Lettrage Invalide", 10);
    const customer = await createCustomer("Client Lettrage Invalide");
    const { delivery } = await deliverOrder(isbnId, customer.id, 2, 10000);
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { sourceType: "delivery", sourceId: delivery.id } });

    const payment = await app.inject({
      method: "POST",
      url: "/api/v1/payments",
      headers: { cookie: adminCookie },
      payload: { method: "cash", amount: 1000, allocations: [{ invoice_id: invoice.id, amount: 500 }] },
    });
    expect(payment.statusCode).toBe(400);
    expect(payment.json().code).toBe("validation_error");
  });

  it("relance graduée du client : rappel puis mise en demeure, puis refus au-delà (Ch. 18 §18.3)", async () => {
    const { isbnId } = await createIsbnWithContractAndStock("Manuscrit Finance Relance", 10);
    const customer = await createCustomer("Client Relance");

    const noBalance = await app.inject({ method: "POST", url: `/api/v1/dunning/${customer.id}/next`, headers: { cookie: adminCookie }, payload: {} });
    expect(noBalance.statusCode).toBe(409);
    expect(noBalance.json().code).toBe("no_outstanding_balance");

    await deliverOrder(isbnId, customer.id, 3, 10000);

    const first = await app.inject({ method: "POST", url: `/api/v1/dunning/${customer.id}/next`, headers: { cookie: adminCookie }, payload: {} });
    expect(first.statusCode).toBe(201);
    expect(first.json().level).toBe("rappel");

    const second = await app.inject({ method: "POST", url: `/api/v1/dunning/${customer.id}/next`, headers: { cookie: adminCookie }, payload: {} });
    expect(second.statusCode).toBe(201);
    expect(second.json().level).toBe("mise_en_demeure");

    const third = await app.inject({ method: "POST", url: `/api/v1/dunning/${customer.id}/next`, headers: { cookie: adminCookie }, payload: {} });
    expect(third.statusCode).toBe(409);
    expect(third.json().code).toBe("max_dunning_level_reached");

    const history = await app.inject({ method: "GET", url: `/api/v1/customers/${customer.id}/dunning`, headers: { cookie: adminCookie } });
    expect(history.json()).toHaveLength(2);
  });

  it("le relevé de droits d'auteur amortit l'à-valoir avant tout paiement (Ch. 9 §9.5, Ch. 18 §18.7)", async () => {
    const { isbnId, contractId } = await createIsbnWithContractAndStock("Manuscrit Finance Droits Avance", 30, {
      base: "prix_public_ht",
      tiers: [{ up_to: null, rate: 0.10 }],
      advance_amount: 20000,
    });
    const customer = await createCustomer("Client Droits Avance");
    await deliverOrder(isbnId, customer.id, 10, 10000); // 10 * 10000 * 10 % = 10000 de droits générés

    const entries = await app.inject({ method: "GET", url: `/api/v1/contracts/${contractId}/royalty-entries`, headers: { cookie: adminCookie } });
    expect(entries.json()).toHaveLength(1);
    expect(Number(entries.json()[0].amount)).toBe(10000);

    const statement = await app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contractId}/royalty-statements`,
      headers: { cookie: adminCookie },
      payload: { period_start: "2000-01-01T00:00:00.000Z", period_end: "2100-01-01T00:00:00.000Z" },
    });
    expect(statement.statusCode).toBe(201);
    expect(Number(statement.json().totalEarned)).toBe(10000);
    expect(Number(statement.json().advanceRecouped)).toBe(10000); // entièrement absorbé par l'à-valoir de 20000
    expect(Number(statement.json().balanceDue)).toBe(0);

    const paymentRefused = await app.inject({
      method: "POST",
      url: `/api/v1/royalty-statements/${statement.json().id}/payments`,
      headers: { cookie: adminCookie },
      payload: { method: "transfer" },
    });
    expect(paymentRefused.statusCode).toBe(409);
    expect(paymentRefused.json().code).toBe("no_balance_due");

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contractId}/royalty-statements`,
      headers: { cookie: adminCookie },
      payload: { period_start: "2050-01-01T00:00:00.000Z", period_end: "2150-01-01T00:00:00.000Z" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe("period_overlap");

    const detail = await app.inject({ method: "GET", url: `/api/v1/royalty-statements/${statement.json().id}`, headers: { cookie: adminCookie } });
    expect(detail.json().entries).toHaveLength(1);
  });

  it("exécute l'ordre de paiement d'un relevé de droits avec retenue fiscale (Ch. 18 §18.7)", async () => {
    const { isbnId, contractId } = await createIsbnWithContractAndStock("Manuscrit Finance Droits Payables", 30, {
      base: "prix_public_ht",
      tiers: [{ up_to: null, rate: 0.10 }],
      advance_amount: 0,
    });
    const customer = await createCustomer("Client Droits Payables");
    await deliverOrder(isbnId, customer.id, 10, 10000); // 10 * 10000 * 10 % = 10000 de droits générés, sans à-valoir

    const statement = await app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contractId}/royalty-statements`,
      headers: { cookie: adminCookie },
      payload: { period_start: "2000-01-01T00:00:00.000Z", period_end: "2100-01-01T00:00:00.000Z" },
    });
    expect(Number(statement.json().balanceDue)).toBe(10000);

    const payment = await app.inject({
      method: "POST",
      url: `/api/v1/royalty-statements/${statement.json().id}/payments`,
      headers: { cookie: adminCookie },
      payload: { method: "transfer", tax_withheld: 1000 },
    });
    expect(payment.statusCode).toBe(201);
    expect(Number(payment.json().amount)).toBe(9000);
    expect(Number(payment.json().taxWithheld)).toBe(1000);

    const statementAfter = await app.inject({ method: "GET", url: `/api/v1/royalty-statements/${statement.json().id}`, headers: { cookie: adminCookie } });
    expect(statementAfter.json().status).toBe("paid");

    const secondAttempt = await app.inject({
      method: "POST",
      url: `/api/v1/royalty-statements/${statement.json().id}/payments`,
      headers: { cookie: adminCookie },
      payload: { method: "transfer" },
    });
    expect(secondAttempt.statusCode).toBe(409);
    expect(secondAttempt.json().code).toBe("already_paid");
  });

  it("répartit le paiement des droits entre plusieurs bénéficiaires (revue opérateur du 04/07/2026)", async () => {
    const { isbnId, contractId } = await createIsbnWithContractAndStock("Manuscrit Finance Droits Partagés", 30, {
      base: "prix_public_ht",
      tiers: [{ up_to: null, rate: 0.10 }],
      advance_amount: 0,
    });
    const customer = await createCustomer("Client Droits Partagés");

    const illustrator = await app.inject({
      method: "POST",
      url: "/api/v1/partners",
      headers: { cookie: adminCookie },
      payload: { category: "illustrateur", first_name: "Illustrateur", last_name: "Test" },
    });
    const authorContract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });

    const beneficiaries = await app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contractId}/beneficiaries`,
      headers: { cookie: adminCookie },
      payload: {
        beneficiaries: [
          { partner_id: authorContract.partnerId, share_pct: 70 },
          { partner_id: illustrator.json().id, share_pct: 30 },
        ],
      },
    });
    expect(beneficiaries.statusCode).toBe(201);

    const invalidSum = await app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contractId}/beneficiaries`,
      headers: { cookie: adminCookie },
      payload: { beneficiaries: [{ partner_id: authorContract.partnerId, share_pct: 60 }] },
    });
    expect(invalidSum.statusCode).toBe(400);

    await deliverOrder(isbnId, customer.id, 10, 10000); // 10 * 10000 * 10 % = 10000 de droits générés

    const statement = await app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contractId}/royalty-statements`,
      headers: { cookie: adminCookie },
      payload: { period_start: "2000-01-01T00:00:00.000Z", period_end: "2100-01-01T00:00:00.000Z" },
    });
    expect(Number(statement.json().balanceDue)).toBe(10000);

    const payment = await app.inject({
      method: "POST",
      url: `/api/v1/royalty-statements/${statement.json().id}/payments`,
      headers: { cookie: adminCookie },
      payload: { method: "transfer" },
    });
    expect(payment.statusCode).toBe(201);
    expect(payment.json().payments).toHaveLength(2);
    const [authorPayment, illustratorPayment] = payment.json().payments;
    expect(Number(authorPayment.amount)).toBe(7000);
    expect(Number(illustratorPayment.amount)).toBe(3000);
    expect(payment.json().remaining_balance).toBe(0);

    const statementAfter = await app.inject({ method: "GET", url: `/api/v1/royalty-statements/${statement.json().id}`, headers: { cookie: adminCookie } });
    expect(statementAfter.json().status).toBe("paid");
  });

  it("accepte des paiements partiels de droits d'auteur avec suivi du solde restant (Ch. 9 §9.5)", async () => {
    const { isbnId, contractId } = await createIsbnWithContractAndStock("Manuscrit Finance Droits Partiels", 30, {
      base: "prix_public_ht",
      tiers: [{ up_to: null, rate: 0.10 }],
      advance_amount: 0,
    });
    const customer = await createCustomer("Client Droits Partiels");
    await deliverOrder(isbnId, customer.id, 10, 10000); // 10000 de droits générés

    const statement = await app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contractId}/royalty-statements`,
      headers: { cookie: adminCookie },
      payload: { period_start: "2000-01-01T00:00:00.000Z", period_end: "2100-01-01T00:00:00.000Z" },
    });

    const firstPayment = await app.inject({
      method: "POST",
      url: `/api/v1/royalty-statements/${statement.json().id}/payments`,
      headers: { cookie: adminCookie },
      payload: { method: "transfer", amount: 4000 },
    });
    expect(firstPayment.statusCode).toBe(201);
    expect(Number(firstPayment.json().amount)).toBe(4000);
    expect(firstPayment.json().remaining_balance).toBe(6000);

    const statementMidway = await app.inject({ method: "GET", url: `/api/v1/royalty-statements/${statement.json().id}`, headers: { cookie: adminCookie } });
    expect(statementMidway.json().status).toBe("issued"); // pas encore soldé
    expect(statementMidway.json().remaining_balance).toBe(6000);

    const secondPayment = await app.inject({
      method: "POST",
      url: `/api/v1/royalty-statements/${statement.json().id}/payments`,
      headers: { cookie: adminCookie },
      payload: { method: "transfer" }, // pas de montant : solde restant par défaut
    });
    expect(secondPayment.statusCode).toBe(201);
    expect(Number(secondPayment.json().amount)).toBe(6000);
    expect(secondPayment.json().remaining_balance).toBe(0);

    const statementFinal = await app.inject({ method: "GET", url: `/api/v1/royalty-statements/${statement.json().id}`, headers: { cookie: adminCookie } });
    expect(statementFinal.json().status).toBe("paid");
  });

  it("applique la retenue fiscale par défaut du contrat si non explicitement surchargée (Ch. 18 §18.7)", async () => {
    const { isbnId, contractId } = await createIsbnWithContractAndStock("Manuscrit Finance Retenue Contrat", 30, {
      base: "prix_public_ht",
      tiers: [{ up_to: null, rate: 0.10 }],
      advance_amount: 0,
      tax_withholding_pct: 15,
    });
    const customer = await createCustomer("Client Retenue Contrat");
    await deliverOrder(isbnId, customer.id, 10, 10000); // 10000 de droits générés

    const statement = await app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contractId}/royalty-statements`,
      headers: { cookie: adminCookie },
      payload: { period_start: "2000-01-01T00:00:00.000Z", period_end: "2100-01-01T00:00:00.000Z" },
    });

    const payment = await app.inject({
      method: "POST",
      url: `/api/v1/royalty-statements/${statement.json().id}/payments`,
      headers: { cookie: adminCookie },
      payload: { method: "transfer" }, // pas de tax_withheld : retenue de 15 % du contrat appliquée
    });
    expect(payment.statusCode).toBe(201);
    expect(Number(payment.json().taxWithheld)).toBe(1500); // 15 % de 10000
    expect(Number(payment.json().amount)).toBe(8500);
  });

  it("choisit le contrat de droits selon le format vendu quand plusieurs contrats actifs coexistent (Ch. 9 §9.5)", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: { title: "Manuscrit Finance Multi-Format", genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "Auteur", last_name: "Multi-Format" } },
    });
    const manuscript = createResponse.json();
    const partnerId = (await prisma.workContributor.findFirstOrThrow({ where: { manuscriptId: manuscript.id } })).partnerId;

    async function createActiveContract(formats: string[], rate: number) {
      const contractResponse = await app.inject({
        method: "POST",
        url: "/api/v1/contracts",
        headers: { cookie: adminCookie },
        payload: {
          type: "edition",
          manuscript_id: manuscript.id,
          partner_id: partnerId,
          formats,
          financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate }], advance_amount: 0 },
        },
      });
      const contract = contractResponse.json();
      for (const status of ["legal_review", "direction_approval", "awaiting_signature", "active"]) {
        await app.inject({ method: "PATCH", url: `/api/v1/contracts/${contract.id}/status`, headers: { cookie: adminCookie }, payload: { status } });
      }
      return contract.id as string;
    }

    const printContractId = await createActiveContract(["print"], 0.10);
    const epubContractId = await createActiveContract(["epub"], 0.15);

    const pool = await app.inject({
      method: "POST",
      url: "/api/v1/isbn-pools",
      headers: { cookie: adminCookie },
      payload: { prefix: uniqueIsbnPrefix(1), digit_width: 1, range_start: 0, range_end: 9 },
    });
    const printIsbn = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/isbn`,
      headers: { cookie: adminCookie },
      payload: { format: "print", pool_id: pool.json().id },
    });
    const epubIsbn = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/isbn`,
      headers: { cookie: adminCookie },
      payload: { format: "epub", pool_id: pool.json().id },
    });

    await app.inject({
      method: "POST",
      url: "/api/v1/stock-movements",
      headers: { cookie: adminCookie },
      payload: { type: "production_in", isbn_id: printIsbn.json().id, to_location_id: warehouseId, quantity: 10, reason: "Réception fabrication" },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/stock-movements",
      headers: { cookie: adminCookie },
      payload: { type: "production_in", isbn_id: epubIsbn.json().id, to_location_id: warehouseId, quantity: 10, reason: "Réception fabrication" },
    });

    const customer = await createCustomer("Client Multi-Format");
    await deliverOrder(printIsbn.json().id, customer.id, 5, 10000); // 5 * 10000 * 10 % = 5000, contrat papier
    await deliverOrder(epubIsbn.json().id, customer.id, 5, 10000); // 5 * 10000 * 15 % = 7500, contrat numérique

    const printEntries = await app.inject({ method: "GET", url: `/api/v1/contracts/${printContractId}/royalty-entries`, headers: { cookie: adminCookie } });
    expect(printEntries.json()).toHaveLength(1);
    expect(Number(printEntries.json()[0].amount)).toBe(5000);

    const epubEntries = await app.inject({ method: "GET", url: `/api/v1/contracts/${epubContractId}/royalty-entries`, headers: { cookie: adminCookie } });
    expect(epubEntries.json()).toHaveLength(1);
    expect(Number(epubEntries.json()[0].amount)).toBe(7500);
  });

  it("la séparation des tâches empêche l'auto-validation d'une dépense (Ch. 18 §18.11)", async () => {
    await createUserWithRole("resp_finance_test", "RESP_FINANCE", "RespFinance123!");
    const respFinanceCookie = await loginCookie(app, "resp_finance_test", "RespFinance123!");

    const expense = await app.inject({
      method: "POST",
      url: "/api/v1/expenses",
      headers: { cookie: respFinanceCookie },
      payload: { category: "prestation", amount: 25000, description: "Prestation de correction externe" },
    });
    expect(expense.statusCode).toBe(201);

    const selfValidate = await app.inject({
      method: "PATCH",
      url: `/api/v1/expenses/${expense.json().id}/validate`,
      headers: { cookie: respFinanceCookie },
      payload: {},
    });
    expect(selfValidate.statusCode).toBe(409);
    expect(selfValidate.json().code).toBe("self_validation_forbidden");

    const validatedByOther = await app.inject({
      method: "PATCH",
      url: `/api/v1/expenses/${expense.json().id}/validate`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(validatedByOther.statusCode).toBe(200);
    expect(validatedByOther.json().status).toBe("validee");
  });

  it("une dépense au-delà du seuil de délégation exige une validation finale de la Direction générale (Ch. 18 §18.11)", async () => {
    await createUserWithRole("resp_finance_test", "RESP_FINANCE", "RespFinance123!");
    const respFinanceCookie = await loginCookie(app, "resp_finance_test", "RespFinance123!");
    await createUserWithRole("dir_general_test", "DIR_GENERAL", "DirGeneral123!");
    const dirGeneralCookie = await loginCookie(app, "dir_general_test", "DirGeneral123!");

    const expense = await app.inject({
      method: "POST",
      url: "/api/v1/expenses",
      headers: { cookie: adminCookie },
      payload: { category: "prestation", amount: 1_200_000, description: "Prestation au-delà du seuil de délégation" },
    });
    expect(expense.statusCode).toBe(201);

    const firstValidation = await app.inject({
      method: "PATCH",
      url: `/api/v1/expenses/${expense.json().id}/validate`,
      headers: { cookie: respFinanceCookie },
      payload: {},
    });
    expect(firstValidation.statusCode).toBe(200);
    expect(firstValidation.json().status).toBe("en_attente_dg");

    const refusedNonDg = await app.inject({
      method: "PATCH",
      url: `/api/v1/expenses/${expense.json().id}/validate`,
      headers: { cookie: respFinanceCookie },
      payload: {},
    });
    expect(refusedNonDg.statusCode).toBe(403);
    expect(refusedNonDg.json().code).toBe("dg_approval_required");

    const finalValidation = await app.inject({
      method: "PATCH",
      url: `/api/v1/expenses/${expense.json().id}/validate`,
      headers: { cookie: dirGeneralCookie },
      payload: {},
    });
    expect(finalValidation.statusCode).toBe(200);
    expect(finalValidation.json().status).toBe("validee");

    const alreadyDone = await app.inject({
      method: "PATCH",
      url: `/api/v1/expenses/${expense.json().id}/validate`,
      headers: { cookie: dirGeneralCookie },
      payload: {},
    });
    expect(alreadyDone.statusCode).toBe(409);
    expect(alreadyDone.json().code).toBe("invalid_transition");
  });

  it("une dépense rattachée à un ouvrage devient un cost_entry et alimente l'analytique (Ch. 18 §18.4-18.5)", async () => {
    const { manuscript } = await createIsbnWithContractAndStock("Manuscrit Finance Analytique", 0);

    const expense = await app.inject({
      method: "POST",
      url: "/api/v1/expenses",
      headers: { cookie: adminCookie },
      payload: { category: "communication", amount: 15000, manuscript_id: manuscript.id, description: "Campagne de promotion" },
    });
    const respFinanceCookie = await loginCookie(app, "resp_finance_test", "RespFinance123!");
    await app.inject({ method: "PATCH", url: `/api/v1/expenses/${expense.json().id}/validate`, headers: { cookie: respFinanceCookie }, payload: {} });

    const costEntry = await prisma.costEntry.findFirstOrThrow({ where: { expenseId: expense.json().id } });
    expect(costEntry.costType).toBe("promotion");
    expect(Number(costEntry.amount)).toBe(15000);

    const analytics = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscript.id}/profitability`, headers: { cookie: adminCookie } });
    expect(analytics.json().total_cost).toBe(15000);
    expect(analytics.json().margin).toBe(-15000);
  });

  it("gère un budget par ouvrage avec révision motivée (Ch. 18 §18.6)", async () => {
    const { manuscript } = await createIsbnWithContractAndStock("Manuscrit Finance Budget", 0);

    const budget = await app.inject({
      method: "POST",
      url: "/api/v1/budgets",
      headers: { cookie: adminCookie },
      payload: { manuscript_id: manuscript.id, label: "Budget de production", lines: [{ cost_type: "manufacturing", planned_amount: 50000 }] },
    });
    expect(budget.statusCode).toBe(201);
    const lineId = budget.json().lines[0].id as string;

    const revised = await app.inject({
      method: "PATCH",
      url: `/api/v1/budget-lines/${lineId}/revise`,
      headers: { cookie: adminCookie },
      payload: { revised_amount: 60000, reason: "Hausse du prix du papier" },
    });
    expect(revised.statusCode).toBe(200);
    expect(Number(revised.json().revisedAmount)).toBe(60000);

    const withActuals = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscript.id}/budgets`, headers: { cookie: adminCookie } });
    expect(withActuals.json()[0].lines[0].over_budget).toBe(false);
  });

  it("gère plusieurs comptes/caisses et les virements internes sans affecter la position globale (Ch. 18 §18.8)", async () => {
    const bank = await app.inject({
      method: "POST",
      url: "/api/v1/bank-accounts",
      headers: { cookie: adminCookie },
      payload: { label: "Compte principal", type: "banque" },
    });
    expect(bank.statusCode).toBe(201);
    const caisse = await app.inject({
      method: "POST",
      url: "/api/v1/bank-accounts",
      headers: { cookie: adminCookie },
      payload: { label: "Caisse comptoir", type: "caisse" },
    });
    expect(caisse.statusCode).toBe(201);

    const positionBefore = await app.inject({ method: "GET", url: "/api/v1/treasury-position", headers: { cookie: adminCookie } });

    const transfer = await app.inject({
      method: "POST",
      url: "/api/v1/account-transfers",
      headers: { cookie: adminCookie },
      payload: { from_account_id: bank.json().id, to_account_id: caisse.json().id, amount: 30000, reason: "Approvisionnement caisse comptoir" },
    });
    expect(transfer.statusCode).toBe(201);

    const bankBalance = await app.inject({ method: "GET", url: `/api/v1/bank-accounts/${bank.json().id}/balance`, headers: { cookie: adminCookie } });
    expect(bankBalance.json().balance).toBe(-30000);
    const caisseBalance = await app.inject({ method: "GET", url: `/api/v1/bank-accounts/${caisse.json().id}/balance`, headers: { cookie: adminCookie } });
    expect(caisseBalance.json().balance).toBe(30000);

    const positionAfter = await app.inject({ method: "GET", url: "/api/v1/treasury-position", headers: { cookie: adminCookie } });
    expect(positionAfter.json().position).toBe(positionBefore.json().position); // virement interne : la position globale ne bouge pas

    const sameAccount = await app.inject({
      method: "POST",
      url: "/api/v1/account-transfers",
      headers: { cookie: adminCookie },
      payload: { from_account_id: bank.json().id, to_account_id: bank.json().id, amount: 1000 },
    });
    expect(sameAccount.statusCode).toBe(400);
  });

  it("importe un relevé bancaire et pointe une ligne avec un paiement (Ch. 18 §18.8)", async () => {
    const bank = await app.inject({
      method: "POST",
      url: "/api/v1/bank-accounts",
      headers: { cookie: adminCookie },
      payload: { label: "Compte à rapprocher", type: "banque" },
    });
    const { isbnId } = await createIsbnWithContractAndStock("Manuscrit Finance Rapprochement", 10);
    const customer = await createCustomer("Client Rapprochement");
    const { delivery } = await deliverOrder(isbnId, customer.id, 2, 10000);
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { sourceType: "delivery", sourceId: delivery.id } });
    const payment = await app.inject({
      method: "POST",
      url: "/api/v1/payments",
      headers: { cookie: adminCookie },
      payload: { method: "transfer", amount: Number(invoice.totalTtc), bank_account_id: bank.json().id, allocations: [{ invoice_id: invoice.id, amount: Number(invoice.totalTtc) }] },
    });

    const statement = await app.inject({
      method: "POST",
      url: `/api/v1/bank-accounts/${bank.json().id}/statements`,
      headers: { cookie: adminCookie },
      payload: {
        period_start: "2026-01-01T00:00:00.000Z",
        period_end: "2026-01-31T00:00:00.000Z",
        lines: [{ transaction_date: "2026-01-15T00:00:00.000Z", label: "Virement reçu", amount: Number(invoice.totalTtc) }],
      },
    });
    expect(statement.statusCode).toBe(201);
    const lineId = statement.json().lines[0].id as string;

    const match = await app.inject({
      method: "PATCH",
      url: `/api/v1/statement-lines/${lineId}/match`,
      headers: { cookie: adminCookie },
      payload: { payment_id: payment.json().id },
    });
    expect(match.statusCode).toBe(200);
    expect(match.json().reconciledAt).not.toBeNull();

    const alreadyReconciled = await app.inject({
      method: "PATCH",
      url: `/api/v1/statement-lines/${lineId}/match`,
      headers: { cookie: adminCookie },
      payload: { payment_id: payment.json().id },
    });
    expect(alreadyReconciled.statusCode).toBe(409);
    expect(alreadyReconciled.json().code).toBe("already_reconciled");

    const list = await app.inject({ method: "GET", url: `/api/v1/bank-accounts/${bank.json().id}/statements`, headers: { cookie: adminCookie } });
    expect(list.json()).toHaveLength(1);
  });

  it("génère un export comptable normalisé avec checksum (Ch. 18 §18.10, Option B)", async () => {
    const periodKey = periodKeyFor(new Date());
    const exportResponse = await app.inject({
      method: "POST",
      url: "/api/v1/accounting/exports",
      headers: { cookie: adminCookie },
      payload: { period_key: periodKey },
    });
    expect(exportResponse.statusCode).toBe(201);
    expect(exportResponse.json().checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(exportResponse.json().csv).toContain("type,reference,date,montant,compte_debit,compte_credit,journal,centre_analytique,piece");
    expect(exportResponse.json().chart_of_accounts_status).toBe("indicatif_non_valide");
    // Écritures présentes dans les tests précédents (factures, dépenses validées).
    expect(exportResponse.json().csv).toMatch(/^invoice,FA-\d{4}-\d{5},.*,411000,707000,VE,/m);
    expect(exportResponse.json().csv).toContain("expense,");

    const list = await app.inject({ method: "GET", url: "/api/v1/accounting/exports", headers: { cookie: adminCookie } });
    expect(list.json().length).toBeGreaterThan(0);
  });

  it("journalise les factures générées automatiquement dans le journal d'audit (Ch. 0 §0.3)", async () => {
    const { isbnId } = await createIsbnWithContractAndStock("Manuscrit Finance Audit", 10);
    const customer = await createCustomer("Client Audit");
    const { delivery } = await deliverOrder(isbnId, customer.id, 2, 10000);
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { sourceType: "delivery", sourceId: delivery.id } });

    const auditEntry = await prisma.auditLog.findFirst({ where: { entityType: "invoice", entityId: invoice.id } });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.action).toBe("create");
  });

  it("une période comptable clôturée bloque toute nouvelle écriture financière (Ch. 18 §18.11)", async () => {
    const periodKey = periodKeyFor(new Date());
    const { isbnId } = await createIsbnWithContractAndStock("Manuscrit Finance Cloture", 10);
    const customer = await createCustomer("Client Cloture");

    const close = await app.inject({
      method: "PATCH",
      url: `/api/v1/accounting/periods/${periodKey}/close`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(close.statusCode).toBe(200);
    expect(close.json().status).toBe("closed");

    try {
      const order = await app.inject({
        method: "POST",
        url: "/api/v1/sales-orders",
        headers: { cookie: adminCookie },
        payload: { customer_id: customer.id, channel: "telephone", location_id: warehouseId, lines: [{ isbn_id: isbnId, quantity: 2, unit_price: 10000 }] },
      });
      const delivery = await app.inject({
        method: "POST",
        url: `/api/v1/sales-orders/${order.json().id}/deliveries`,
        headers: { cookie: adminCookie },
        payload: { carrier: "Transporteur", lines: [{ isbn_id: isbnId, quantity: 2 }] },
      });
      expect(delivery.statusCode).toBe(409);
      expect(delivery.json().code).toBe("accounting_period_closed");
    } finally {
      // Rouvre la période pour ne pas bloquer les autres suites de tests
      // exécutées dans la même fenêtre de temps réelle (fichiers séquentiels,
      // cf. vitest.config.ts).
      await prisma.accountingPeriod.update({ where: { periodKey }, data: { status: "open", closedAt: null, closedBy: null } });
    }
  });
});
