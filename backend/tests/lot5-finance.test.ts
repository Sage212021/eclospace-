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

  async function createCustomer(name: string, category = "particulier", creditLimit?: number) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/customers",
      headers: { cookie: adminCookie },
      payload: { category, name, credit_limit: creditLimit },
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
    expect(exportResponse.json().csv).toContain("type,reference,date,montant");

    const list = await app.inject({ method: "GET", url: "/api/v1/accounting/exports", headers: { cookie: adminCookie } });
    expect(list.json().length).toBeGreaterThan(0);
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
