import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Point de vente (dimension) + rapport d'encaissements (par mode, compte, point
// de vente). Socle des rapports demandés par l'opérateur.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("points de vente et rapport d'encaissements", () => {
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

  it("crée un point de vente (admin) et le liste ; un non-habilité est refusé", async () => {
    const create = await app.inject({ method: "POST", url: "/api/v1/points-of-sale", headers: { cookie }, payload: { name: "Salon du livre de Yaoundé", type: "salon" } });
    expect(create.statusCode).toBe(201);
    const list = await app.inject({ method: "GET", url: "/api/v1/points-of-sale", headers: { cookie } });
    expect(list.json().some((p: { name: string }) => p.name === "Salon du livre de Yaoundé")).toBe(true);

    await createUserWithRole(`corr_pos_${Math.random().toString(36).slice(2, 6)}`, "CORRECTEUR", "Corr123!");
    const corrCookie = await loginCookie(app, (await prisma.user.findFirstOrThrow({ where: { username: { startsWith: "corr_pos_" } }, orderBy: { createdAt: "desc" } })).username, "Corr123!");
    const denied = await app.inject({ method: "POST", url: "/api/v1/points-of-sale", headers: { cookie: corrCookie }, payload: { name: "X", type: "librairie" } });
    expect(denied.statusCode).toBe(403);
  });

  it("le rapport d'encaissements agrège par mode, compte et point de vente", async () => {
    // Un encaissement en espèces sur une facture minimale.
    const customer = await prisma.customer.create({ data: { category: "librairie", name: `Cli ${Math.random().toString(36).slice(2, 6)}` } });
    const invoice = await prisma.invoice.create({
      data: { invoiceNumber: `FA-R-${Math.random().toString(36).slice(2, 8)}`, customerId: customer.id, sourceType: "test", sourceId: "x", totalHt: 5000, totalTax: 0, totalTtc: 5000, status: "issued" },
    });
    const pay = await app.inject({ method: "POST", url: "/api/v1/payments", headers: { cookie }, payload: { method: "cash", amount: 5000, allocations: [{ invoice_id: invoice.id, amount: 5000 }] } });
    expect(pay.statusCode).toBe(201);

    const report = await app.inject({ method: "GET", url: "/api/v1/finance/payment-report", headers: { cookie } });
    expect(report.statusCode).toBe(200);
    const body = report.json();
    expect(Array.isArray(body.by_method)).toBe(true);
    const cash = body.by_method.find((m: { method: string }) => m.method === "cash");
    expect(cash).toBeTruthy();
    expect(cash.total).toBeGreaterThanOrEqual(5000);
    expect(Array.isArray(body.by_account)).toBe(true);
    expect(Array.isArray(body.by_point_of_sale)).toBe(true);
  });
});
