import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

// Bilan mensuel de trésorerie : entrées (paiements « in ») − dépenses (module
// Dépenses, statuts validée + payée) = solde, par mois. On isole les données sur
// une année LOINTAINE (2099) pour ne dépendre d'aucune autre opération.
describe("Bilan mensuel de trésorerie", () => {
  let app: FastifyInstance;
  let cookie: string;
  const paymentIds: string[] = [];
  const expenseIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));

    const pay = async (direction: "in" | "out", amount: number, iso: string) => {
      const p = await prisma.payment.create({ data: { direction, method: "especes", amount, receivedAt: new Date(iso), createdAt: new Date(iso) } });
      paymentIds.push(p.id);
    };
    const exp = async (amount: number, category: "transport" | "loyer" | "autre", status: "validee" | "payee" | "a_valider" | "rejetee", iso: string) => {
      // expenseDate = date réelle de la dépense : le bilan répartit par mois selon elle.
      const e = await prisma.expense.create({ data: { amount, category, status, expenseDate: new Date(iso), createdAt: new Date(iso) } });
      expenseIds.push(e.id);
    };

    // Septembre 2099 : 2 encaissements (3 000 000), 2 dépenses (1 750 000) +
    // 1 décaissement de trésorerie (paiement « out » = droits d'auteur, 250 000).
    await pay("in", 2_500_000, "2099-09-15T10:00:00.000Z");
    await pay("in", 500_000, "2099-09-20T10:00:00.000Z");
    await pay("out", 250_000, "2099-09-10T10:00:00.000Z"); // décaissement → compté en sortie
    await exp(1_000_000, "transport", "validee", "2099-09-05T10:00:00.000Z");
    await exp(750_000, "loyer", "payee", "2099-09-12T10:00:00.000Z");
    await exp(999, "autre", "a_valider", "2099-09-01T10:00:00.000Z"); // non validée → ignorée
    await exp(999, "autre", "rejetee", "2099-09-02T10:00:00.000Z"); // rejetée → ignorée
    // Octobre 2099 : une entrée isolée.
    await pay("in", 100_000, "2099-10-05T10:00:00.000Z");
  });

  afterAll(async () => {
    await prisma.expense.deleteMany({ where: { id: { in: expenseIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("additionne entrées et dépenses par mois et calcule le solde", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/finance/monthly-balance?year=2099", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      year: number;
      months: { month: number; entrees: number; depenses: number; solde: number; depensesParCategorie: Record<string, number> }[];
      totals: { entrees: number; depenses: number; solde: number };
    };
    expect(body.year).toBe(2099);
    expect(body.months).toHaveLength(12);

    const sept = body.months[8]; // septembre
    expect(sept.month).toBe(9);
    expect(sept.entrees).toBe(3_000_000);
    // Sorties = dépenses validées/payées (1 750 000) + décaissement trésorerie (250 000).
    expect(sept.depenses).toBe(2_000_000);
    expect(sept.solde).toBe(1_000_000);
    expect(sept.depensesParCategorie.transport).toBe(1_000_000);
    expect(sept.depensesParCategorie.loyer).toBe(750_000);
    expect(sept.depensesParCategorie.droits_auteur).toBe(250_000);

    const octo = body.months[9];
    expect(octo.entrees).toBe(100_000);
    expect(octo.depenses).toBe(0);
    expect(octo.solde).toBe(100_000);

    // Cumul annuel (uniquement nos données de 2099).
    expect(body.totals.entrees).toBe(3_100_000);
    expect(body.totals.depenses).toBe(2_000_000);
    expect(body.totals.solde).toBe(1_100_000);
  });

  it("classe la dépense selon sa DATE RÉELLE (expense_date), pas la date de saisie", async () => {
    // Dépense engagée en mars 2098 mais SAISIE en septembre 2098.
    const e = await prisma.expense.create({
      data: {
        amount: 500_000,
        category: "transport",
        status: "validee",
        expenseDate: new Date("2098-03-15T10:00:00.000Z"),
        createdAt: new Date("2098-09-20T10:00:00.000Z"),
      },
    });
    expenseIds.push(e.id);

    const res = await app.inject({ method: "GET", url: "/api/v1/finance/monthly-balance?year=2098", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { months: { month: number; depenses: number }[] };
    // Rangée en MARS (index 2), la date réelle — pas en septembre (index 8), la saisie.
    expect(body.months[2].depenses).toBe(500_000);
    expect(body.months[8].depenses).toBe(0);
  });

  it("POST /expenses accepte une date de dépense (expense_date) et la conserve", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/expenses",
      headers: { cookie },
      payload: { category: "autre", amount: 12345, description: "Dépense datée", expense_date: "2097-05-10T12:00:00.000Z" },
    });
    expect(created.statusCode).toBe(201);
    expenseIds.push(created.json().id);
    expect(created.json().expenseDate.slice(0, 10)).toBe("2097-05-10");
  });
});
