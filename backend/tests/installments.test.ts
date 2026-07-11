import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Échéancier de crédit : plan d'échéances d'une facture + statut (retard) selon
// le montant déjà réglé.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

async function newInvoice(total: number) {
  const customer = await prisma.customer.create({ data: { category: "librairie", name: `Cli ${Math.random().toString(36).slice(2, 6)}` } });
  return prisma.invoice.create({
    data: { invoiceNumber: `FA-E-${Math.random().toString(36).slice(2, 8)}`, customerId: customer.id, sourceType: "test", sourceId: "x", totalHt: total, totalTax: 0, totalTtc: total, status: "issued" },
  });
}

describe("échéancier de crédit", () => {
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

  it("définit un échéancier et repère l'échéance en retard", async () => {
    const invoice = await newInvoice(5000);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoice.id}/schedule`,
      headers: { cookie },
      payload: {
        installments: [
          { due_date: "2026-01-15T00:00:00.000Z", amount: 2000, note: "Acompte" },
          { due_date: "2099-12-31T00:00:00.000Z", amount: 3000 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.installments).toHaveLength(2);
    expect(Number(body.planned)).toBe(5000);
    // Première échéance échue et non réglée → en retard ; seconde à venir → en attente.
    expect(body.installments[0].status).toBe("overdue");
    expect(body.installments[1].status).toBe("pending");
  });

  it("refuse un échéancier dont le total dépasse la facture (400)", async () => {
    const invoice = await newInvoice(1000);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoice.id}/schedule`,
      headers: { cookie },
      payload: { installments: [{ due_date: "2026-06-01T00:00:00.000Z", amount: 2000 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("schedule_exceeds_total");
  });
});
