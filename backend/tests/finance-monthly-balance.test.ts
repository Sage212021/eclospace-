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
      const e = await prisma.expense.create({ data: { amount, category, status, createdAt: new Date(iso) } });
      expenseIds.push(e.id);
    };

    // Septembre 2099 : 2 encaissements (3 000 000), 2 dépenses comptées (1 750 000).
    await pay("in", 2_500_000, "2099-09-15T10:00:00.000Z");
    await pay("in", 500_000, "2099-09-20T10:00:00.000Z");
    await pay("out", 999, "2099-09-10T10:00:00.000Z"); // sortie ignorée (pas une entrée)
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
    expect(sept.depenses).toBe(1_750_000);
    expect(sept.solde).toBe(1_250_000);
    expect(sept.depensesParCategorie.transport).toBe(1_000_000);
    expect(sept.depensesParCategorie.loyer).toBe(750_000);

    const octo = body.months[9];
    expect(octo.entrees).toBe(100_000);
    expect(octo.depenses).toBe(0);
    expect(octo.solde).toBe(100_000);

    // Cumul annuel (uniquement nos données de 2099).
    expect(body.totals.entrees).toBe(3_100_000);
    expect(body.totals.depenses).toBe(1_750_000);
    expect(body.totals.solde).toBe(1_350_000);
  });
});
