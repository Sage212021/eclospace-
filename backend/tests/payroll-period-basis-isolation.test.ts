import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// ISOLATION STRICTE DE LA PAIE PAR PÉRIODE (D-070, correction critique opérateur).
// Reproduit le bug : modifier la fiche du salarié (salaire actuel) NE DOIT PAS
// recalculer les mois déjà préparés. Chaque mois est une photographie autonome
// figée sur sa ligne. Périodes lointaines pour ne pas heurter la DB partagée.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const JUL = "2088-07";
const AOUT = "2088-08";

describe("Paie — isolation stricte de l'assiette par période (D-070)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let empId: string;

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };
  const putProfile = (gross: number, reason?: string) =>
    app.inject({
      method: "PUT", url: `/api/v1/payroll/employees/${empId}/profile`, headers: { cookie },
      payload: { gross_contractual: gross, base_pct: 1, fiscal_parts: 1, apply_fiscal_parts: false, seniority_years: 0, apply_seniority: false, ...(reason ? { modification_reason: reason } : {}) },
    });
  const prepare = (period: string) => app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${period}/prepare`, headers: { cookie } });
  const gridRow = async (period: string) => {
    const r = await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${period}`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const row = (r.json().lines as Array<{ employee_id: string; period_base_salary: number; net_a_payer: number }>).find((l) => l.employee_id === empId);
    expect(row).toBeTruthy();
    return row!;
  };
  const patchLine = (period: string, baseSalary: number) =>
    app.inject({
      method: "PATCH", url: `/api/v1/payroll/monthly/${period}/lines/${empId}`, headers: { cookie },
      payload: { base_salary: baseSalary, gross_contractual: baseSalary, heures_sup: 0, retenue_absence: 0, retard: 0, avance: 0, pret: 0, sanction: 0, autres: 0 },
    });

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login("admin", ADMIN_PASSWORD);
    // Barème en vigueur pour ces périodes (postérieur aux autres barèmes de test).
    await prisma.payrollRateSet.create({
      data: {
        effectiveFrom: new Date("2088-01-01T00:00:00.000Z"), label: "Barème D-070",
        vidSalPct: 0.042, vidPatPct: 0.042, pfPct: 0.07, atPct: 0.025, cnpsCeiling: 750000,
        abatPct: 0.3, abatFixe: 500000, cacPct: 0.1, cfcSalPct: 0.01, cfcPatPct: 0.015, fnePct: 0.01,
        coefAssiette: 0.8, heuresMois: 173.33, ancDefPct: 0.05,
        irppT1Ceiling: 2000000, irppT1Pct: 0.1, irppT2Ceiling: 3000000, irppT2Pct: 0.15,
        irppT3Ceiling: 5000000, irppT3Pct: 0.25, irppT4Pct: 0.35,
        tcRavSeuil1: 110000, tc1: 0, rav1: 1950, tcRavSeuil2: 200000, tc2: 500, rav2: 1950, tc3: 750, rav3: 3250,
      },
    });
    const e = await prisma.employee.create({ data: { firstName: "Iso", lastName: "Période2088" } });
    empId = e.id;
    const prof = await putProfile(75000);
    expect(prof.statusCode).toBe(200);
  });

  afterAll(async () => {
    for (const period of [JUL, AOUT]) {
      const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period } });
      if (run) {
        await prisma.payrollMonthlyLine.deleteMany({ where: { runId: run.id } });
        await prisma.payrollMonthlyRun.delete({ where: { id: run.id } });
      }
    }
    await app.close();
    await prisma.$disconnect();
  });

  it("Test 1 — juillet 75 000 puis août 100 000 : modifier la fiche n'altère pas juillet", async () => {
    // Juillet préparé avec la fiche à 75 000.
    expect((await prepare(JUL)).statusCode).toBe(200);
    const jul = await gridRow(JUL);
    expect(jul.period_base_salary).toBe(75000);
    const netJulInitial = jul.net_a_payer;

    // La fiche passe à 100 000 (effet à partir d'août) ; août est préparé ensuite.
    expect((await putProfile(100000, "Augmentation à partir d'août")).statusCode).toBe(200);
    expect((await prepare(AOUT)).statusCode).toBe(200);
    const aout = await gridRow(AOUT);
    expect(aout.period_base_salary).toBe(100000);

    // ⛔ LE BUG : juillet ne doit PAS avoir bougé (ni sa base, ni son net).
    const julAfter = await gridRow(JUL);
    expect(julAfter.period_base_salary).toBe(75000);
    expect(julAfter.net_a_payer).toBe(netJulInitial);
    // Les deux mois coexistent avec des bases différentes.
    expect(aout.net_a_payer).not.toBe(netJulInitial);
  });

  it("Test 1 (suite) — modifier la base d'août à 120 000 ne touche pas juillet", async () => {
    expect((await patchLine(AOUT, 120000)).statusCode).toBe(200);
    expect((await gridRow(AOUT)).period_base_salary).toBe(120000);
    expect((await gridRow(JUL)).period_base_salary).toBe(75000);
  });

  it("le bulletin d'une période utilise exclusivement les données de cette période", async () => {
    const bulletinJul = await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${empId}/payslip?period=${JUL}`, headers: { cookie } });
    expect(bulletinJul.statusCode).toBe(200);
    expect(bulletinJul.json().payslip.base).toBe(75000);
    const bulletinAout = await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${empId}/payslip?period=${AOUT}`, headers: { cookie } });
    expect(bulletinAout.json().payslip.base).toBe(120000);
  });

  it("Test 3 — clôturer (valider) juillet puis modifier la fiche : juillet reste identique", async () => {
    const julBefore = await gridRow(JUL);
    // Soumission RH → validation DG (admin = ADMIN_GENERAL).
    expect((await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${JUL}/submit`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${JUL}/validate`, headers: { cookie } })).statusCode).toBe(200);

    // On modifie la fiche APRÈS clôture de juillet.
    expect((await putProfile(250000, "Nouvelle hausse")).statusCode).toBe(200);

    const julAfter = await gridRow(JUL);
    expect(julAfter.period_base_salary).toBe(75000);
    expect(julAfter.net_a_payer).toBe(julBefore.net_a_payer);
  });
});
