import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Modes de paiement configurables (socle du module paiements). On vérifie la
// liste, l'ajout d'un mode personnalisé, l'unicité du code, la validation à
// l'encaissement, l'association automatique au compte par défaut et la référence.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("modes de paiement configurables", () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("liste les 5 modes historiques et en ajoute un personnalisé", async () => {
    const list = await app.inject({ method: "GET", url: "/api/v1/payment-methods", headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const codes = list.json().map((m: { code: string }) => m.code);
    expect(codes).toEqual(expect.arrayContaining(["cash", "transfer", "cheque", "card", "mobile_money"]));

    const code = `wave_${Math.random().toString(36).slice(2, 6)}`;
    const create = await app.inject({ method: "POST", url: "/api/v1/payment-methods", headers: { cookie }, payload: { code, label: "Wave", kind: "mobile_money" } });
    expect(create.statusCode).toBe(201);

    // Code déjà pris → 409.
    const dup = await app.inject({ method: "POST", url: "/api/v1/payment-methods", headers: { cookie }, payload: { code, label: "Wave bis", kind: "mobile_money" } });
    expect(dup.statusCode).toBe(409);
  });

  it("refuse un encaissement avec un mode inconnu (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/payments",
      headers: { cookie },
      payload: { method: "inexistant", amount: 1000, allocations: [{ invoice_id: "11111111-1111-1111-1111-111111111111", amount: 1000 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_payment_method");
  });

  it("encaissement : compte par défaut du mode appliqué + référence enregistrée", async () => {
    // Compte caisse + associé par défaut au mode « espèces ».
    const acc = await app.inject({ method: "POST", url: "/api/v1/bank-accounts", headers: { cookie }, payload: { label: "Caisse principale", type: "caisse" } });
    const accountId = acc.json().id;
    const cash = await prisma.paymentMethodDef.findUniqueOrThrow({ where: { code: "cash" } });
    await app.inject({ method: "PATCH", url: `/api/v1/payment-methods/${cash.id}`, headers: { cookie }, payload: { default_account_id: accountId } });

    // Facture minimale à encaisser.
    const customer = await prisma.customer.create({ data: { category: "librairie", name: `Client ${Math.random().toString(36).slice(2, 6)}` } });
    const invoice = await prisma.invoice.create({
      data: { invoiceNumber: `FA-T-${Math.random().toString(36).slice(2, 8)}`, customerId: customer.id, sourceType: "test", sourceId: "x", totalHt: 1000, totalTax: 0, totalTtc: 1000, status: "issued" },
    });

    const pay = await app.inject({
      method: "POST",
      url: "/api/v1/payments",
      headers: { cookie },
      payload: { method: "cash", reference: "REC-2026-0001", amount: 1000, allocations: [{ invoice_id: invoice.id, amount: 1000 }] },
    });
    expect(pay.statusCode).toBe(201);
    const payment = pay.json();
    expect(payment.method).toBe("cash");
    expect(payment.reference).toBe("REC-2026-0001");
    // Compte non fourni → compte par défaut du mode appliqué automatiquement.
    expect(payment.bankAccountId).toBe(accountId);

    // Nettoyage du défaut pour ne pas influencer d'autres tests.
    await app.inject({ method: "PATCH", url: `/api/v1/payment-methods/${cash.id}`, headers: { cookie }, payload: { default_account_id: null } });
  });
});
