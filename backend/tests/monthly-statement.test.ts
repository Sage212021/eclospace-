import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Bilan mensuel détaillé (Ch. 18) : solde initial (cumul avant le mois), lignes
// entrées/sorties, totaux, solde net/final, excédent/déficit, isolation par mois.
// Année isolée (insertion directe) pour des montants déterministes.
const PWD = "TestAdmin123!";
const YEAR = 2099;

async function statement(app: FastifyInstance, cookie: string, month: string) {
  const r = await app.inject({ method: "GET", url: `/api/v1/finance/monthly-statement?month=${month}`, headers: { cookie } });
  return r.json() as {
    solde_initial: number; total_entrees: number; total_sorties: number; solde_net: number; solde_final: number;
    situation: string; entrees: { amount: number; reference: string }[]; sorties: { amount: number; category: string }[];
  };
}

describe("Bilan mensuel détaillé", () => {
  let app: FastifyInstance;
  let cookie: string;
  const payIds: string[] = [];
  const expIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: PWD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    const adminId = (await prisma.user.findFirstOrThrow({ where: { username: "admin" } })).id;
    const mkPay = async (iso: string, amount: number, direction: "in" | "out") => {
      const p = await prisma.payment.create({ data: { direction, method: "cash", amount, receivedAt: new Date(iso), createdBy: adminId, reference: `TST-${iso}-${direction}` } });
      payIds.push(p.id);
    };
    const mkExp = async (iso: string, amount: number) => {
      const e = await prisma.expense.create({ data: { category: "transport", amount, status: "validee", expenseDate: new Date(iso), createdBy: adminId, description: "Test sortie" } });
      expIds.push(e.id);
    };
    await mkPay(`${YEAR}-02-10T00:00:00.000Z`, 100000, "in"); // mois précédent → solde initial de mars
    await mkPay(`${YEAR}-03-05T00:00:00.000Z`, 80000, "in"); // entrée de mars
    await mkExp(`${YEAR}-03-12T00:00:00.000Z`, 30000); // sortie de mars
    await mkExp(`${YEAR}-04-10T00:00:00.000Z`, 5000); // sortie d'avril (mois déficitaire)
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { id: { in: payIds } } }).catch(() => {});
    await prisma.expense.deleteMany({ where: { id: { in: expIds } } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("mars : détail entrées/sorties, totaux, solde net, excédent (montants du mois isolés)", async () => {
    const s = await statement(app, cookie, `${YEAR}-03`);
    expect(s.total_entrees).toBe(80000); // seule l'entrée de mars
    expect(s.total_sorties).toBe(30000); // seule la sortie de mars
    expect(s.solde_net).toBe(50000); // 80000 − 30000
    expect(s.situation).toBe("excedent");
    // Solde final = solde initial (cumul réel) + solde net.
    expect(s.solde_final).toBe(s.solde_initial + s.solde_net);
    // Détail ligne par ligne présent.
    expect(s.entrees.some((e) => e.amount === 80000)).toBe(true);
    expect(s.sorties.some((e) => e.amount === 30000)).toBe(true);
  });

  it("isolation : les mouvements de mars n'apparaissent pas en avril, et le solde se chaîne", async () => {
    const mars = await statement(app, cookie, `${YEAR}-03`);
    const avril = await statement(app, cookie, `${YEAR}-04`);
    // Le solde final de mars devient le solde initial d'avril (chaînage).
    expect(avril.solde_initial).toBe(mars.solde_final);
    expect(avril.total_entrees).toBe(0); // aucune entrée en avril
    expect(avril.entrees.length).toBe(0);
    expect(avril.total_sorties).toBe(5000); // seule la sortie d'avril
  });

  it("avril : mois déficitaire correctement identifié", async () => {
    const s = await statement(app, cookie, `${YEAR}-04`);
    expect(s.solde_net).toBe(-5000);
    expect(s.situation).toBe("deficit");
    expect(s.solde_final).toBe(s.solde_initial - 5000);
  });
});
