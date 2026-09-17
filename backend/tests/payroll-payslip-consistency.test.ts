import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// CORRECTION CRITIQUE — cohérence bulletin ↔ grille ↔ soumission ↔ clôture.
// Cas M. BIBI TSANGA : la « Fiche de paie » affichait un net (sans les retenues
// du mois) différent du montant utilisé pour la clôture (avec les retenues). Le
// bulletin, la génération, la soumission et la clôture doivent désormais donner
// EXACTEMENT le même net, calculés à partir de la MÊME ligne de paie (§11).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const PERIOD = "2091-08";
const FUTUR = "2091-12"; // période non préparée → référence « sans retenues »

describe("Paie — bulletin = grille = clôture (cas BIBI TSANGA)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let bibiId: string;

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };
  const payslipNet = async (period: string): Promise<number> => {
    const r = await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${bibiId}/payslip?period=${period}`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    return r.json().payslip.net_a_payer as number;
  };
  const registerNet = async (period: string): Promise<number> => {
    const r = await app.inject({ method: "GET", url: `/api/v1/payroll/register?period=${period}`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    return (r.json().lines as Array<{ employee_id: string; net_a_payer: number }>).find((l) => l.employee_id === bibiId)!.net_a_payer;
  };

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login("admin", ADMIN_PASSWORD);
    const bibi = await prisma.employee.create({ data: { firstName: "Bibi", lastName: "Tsanga" } });
    bibiId = bibi.id;
    await app.inject({
      method: "PUT", url: `/api/v1/payroll/employees/${bibiId}/profile`, headers: { cookie },
      payload: { gross_contractual: 220000, base_pct: 1, fiscal_parts: 1, apply_fiscal_parts: true, seniority_years: 0, apply_seniority: false },
    });
    // Préparer le mois → une ligne de paie pour BIBI.
    await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/prepare`, headers: { cookie } });
    // Retenues du mois RÉELLEMENT enregistrées sur sa ligne : avance 100 000 + prêt 30 000.
    const run = await prisma.payrollMonthlyRun.findUniqueOrThrow({ where: { periodKey: PERIOD } });
    await prisma.payrollMonthlyLine.update({ where: { runId_employeeId: { runId: run.id, employeeId: bibiId } }, data: { avance: 100000, pret: 30000 } });
  });

  afterAll(async () => {
    await prisma.payrollClosure.deleteMany({ where: { periodKey: PERIOD } }).catch(() => {});
    await prisma.payrollMonthlyRun.deleteMany({ where: { periodKey: PERIOD } }).catch(() => {});
    await prisma.payrollEmployeeProfile.deleteMany({ where: { employeeId: bibiId } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { id: bibiId } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("la fiche de paie applique les retenues du mois (comme la grille)", async () => {
    const fiche = await payslipNet(PERIOD);
    const grille = await registerNet(PERIOD);
    // Le bulletin et la grille/soumission donnent le MÊME net.
    expect(fiche).toBe(grille);
    // Référence « sans retenues » (mois non préparé) : les retenues du mois
    // (avance 100 000 + prêt 30 000 = 130 000) réduisent bien le net.
    const sansRetenues = await payslipNet(FUTUR);
    expect(sansRetenues - fiche).toBe(130000);
  });

  it("la clôture archive exactement le même net que le bulletin", async () => {
    const fiche = await payslipNet(PERIOD);
    const close = await app.inject({ method: "POST", url: `/api/v1/payroll/register/${PERIOD}/close`, headers: { cookie } });
    expect(close.statusCode).toBe(200);
    const journal = (await app.inject({ method: "GET", url: `/api/v1/payroll/journal/${PERIOD}`, headers: { cookie } })).json();
    const mine = (journal.lines as Array<{ employee_id: string; net_a_payer: number }>).find((l) => l.employee_id === bibiId)!;
    expect(mine.net_a_payer).toBe(fiche);
  });
});
