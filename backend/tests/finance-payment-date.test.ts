import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

// D-043 : un encaissement porte une DATE RÉELLE (received_at). Le bilan de
// trésorerie classe l'entrée dans SON mois (donc son trimestre / semestre), et
// non dans le mois de saisie — sans quoi tout s'agrège dans le mois courant et
// la ventilation « ne donne que par an » (signalé par le DAF).
describe("Encaissement daté à sa date réelle (bilan par période)", () => {
  let app: FastifyInstance;
  let cookie: string;
  const YEAR = 2015; // année PASSÉE et isolée (received_at doit être ≤ aujourd'hui)
  const customerIds: string[] = [];
  const invoiceIds: string[] = [];

  const login = async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  const makeInvoice = async (amount: number) => {
    const customer = await prisma.customer.create({ data: { category: "librairie", name: `Client ${Math.random().toString(36).slice(2, 7)}` } });
    customerIds.push(customer.id);
    const invoice = await prisma.invoice.create({
      data: { invoiceNumber: `FA-D043-${Math.random().toString(36).slice(2, 8)}`, customerId: customer.id, sourceType: "test", sourceId: "x", totalHt: amount, totalTax: 0, totalTtc: amount, status: "issued" },
    });
    invoiceIds.push(invoice.id);
    return invoice;
  };

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login();
  });

  afterAll(async () => {
    await prisma.paymentAllocation.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.payment.deleteMany({ where: { allocations: { some: { invoiceId: { in: invoiceIds } } } } }).catch(() => {});
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("classe l'encaissement dans le mois de received_at, pas dans le mois de saisie", async () => {
    const invoice = await makeInvoice(400000);
    const res = await app.inject({
      method: "POST", url: "/api/v1/payments", headers: { cookie },
      payload: { method: "cash", amount: 400000, received_at: `${YEAR}-03-10T09:00:00.000Z`, allocations: [{ invoice_id: invoice.id, amount: 400000 }] },
    });
    expect(res.statusCode).toBe(201);

    const bilan = (await app.inject({ method: "GET", url: `/api/v1/finance/monthly-balance?year=${YEAR}`, headers: { cookie } })).json() as {
      months: { month: number; entrees: number }[];
    };
    const march = bilan.months.find((m) => m.month === 3)!;
    const september = bilan.months.find((m) => m.month === 9)!;
    expect(march.entrees).toBe(400000); // classé en mars (T1 / S1)
    expect(september.entrees).toBe(0); // pas dans un autre mois
  });

  it("refuse une date d'encaissement future (400)", async () => {
    const invoice = await makeInvoice(1000);
    const res = await app.inject({
      method: "POST", url: "/api/v1/payments", headers: { cookie },
      payload: { method: "cash", amount: 1000, received_at: "2999-01-01T00:00:00.000Z", allocations: [{ invoice_id: invoice.id, amount: 1000 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("date_future");
  });

  it("sans received_at, l'encaissement prend la date du jour (défaut)", async () => {
    const invoice = await makeInvoice(2000);
    const before = Date.now();
    const res = await app.inject({
      method: "POST", url: "/api/v1/payments", headers: { cookie },
      payload: { method: "cash", amount: 2000, allocations: [{ invoice_id: invoice.id, amount: 2000 }] },
    });
    expect(res.statusCode).toBe(201);
    const alloc = await prisma.paymentAllocation.findFirst({ where: { invoiceId: invoice.id }, include: { payment: true } });
    expect(alloc?.payment.receivedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});
