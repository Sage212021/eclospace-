import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Règle métier (07/08/2026) : la retenue d'absence du cahier de présence est un
// TÉMOIN indicatif — elle n'alimente JAMAIS automatiquement le calcul de la paie.
// La retenue appliquée est celle que le RH saisit sur le bulletin.

describe("découplage présences ↔ paie", () => {
  let app: FastifyInstance;
  let cookie: string;
  let employeeId: string;
  const period = "2030-03"; // période dédiée (DB de test partagée entre fichiers)

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
    // DB de test partagée et persistante : on repart propre pour cette période.
    await prisma.attendancePayrollLine.deleteMany({ where: { period: { periodKey: period } } });
    await prisma.attendancePayrollPeriod.deleteMany({ where: { periodKey: period } });
    const emp = await prisma.employee.create({ data: { firstName: "Découpl", lastName: "Présence" } });
    employeeId = emp.id;
    await prisma.payrollRateSet.create({
      data: {
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), label: "Barème découplage",
        vidSalPct: 0.042, vidPatPct: 0.042, pfPct: 0.07, atPct: 0.025, cnpsCeiling: 750000,
        abatPct: 0.3, abatFixe: 500000, cacPct: 0.1, cfcSalPct: 0.01, cfcPatPct: 0.015, fnePct: 0.01,
        coefAssiette: 0.8, heuresMois: 173.33, ancDefPct: 0.05,
        irppT1Ceiling: 2000000, irppT1Pct: 0.1, irppT2Ceiling: 3000000, irppT2Pct: 0.15,
        irppT3Ceiling: 5000000, irppT3Pct: 0.25, irppT4Pct: 0.35,
        tcRavSeuil1: 110000, tc1: 0, rav1: 1950, tcRavSeuil2: 200000, tc2: 500, rav2: 1950, tc3: 750, rav3: 3250,
      },
    });
    await app.inject({
      method: "PUT", url: `/api/v1/payroll/employees/${employeeId}/profile`, headers: { cookie },
      payload: { gross_contractual: 500000, base_pct: 1, fiscal_parts: 1, apply_fiscal_parts: true, seniority_years: 0, apply_seniority: false },
    });
    // Cahier de présence consolidé avec une retenue proposée de 60 000 (témoin).
    const cons = await prisma.attendancePayrollPeriod.create({
      data: { periodKey: period, fromDate: new Date("2030-03-01"), toDate: new Date("2030-03-31") },
    });
    await prisma.attendancePayrollLine.create({
      data: {
        periodId: cons.id, employeeId, workedMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0,
        overtimeMinutes: 0, daysWorked: 20, daysAbsentUnjustified: 2, daysAbsentJustified: 0,
        deductionProposed: 60000,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("le bulletin N'APPLIQUE PAS la retenue du cahier de présence (retenue = 0, témoin exposé)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${employeeId}/payslip?period=${period}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.payslip.retenue_absence).toBe(0);
    expect(b.attendance_witness).toBe(60000); // témoin indicatif, non appliqué
  });

  it("la retenue saisie par le RH est appliquée et fait baisser le net", async () => {
    const sans = (await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${employeeId}/payslip?period=${period}`, headers: { cookie } })).json();
    const avec = (await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${employeeId}/payslip?period=${period}&retenue_absence=50000`, headers: { cookie } })).json();
    expect(avec.payslip.retenue_absence).toBe(50000);
    expect(avec.payslip.net_a_payer).toBeLessThan(sans.payslip.net_a_payer);
    // Le témoin reste inchangé quelle que soit la saisie.
    expect(avec.attendance_witness).toBe(60000);
  });

  it("les retenues internes (prêt, avance, retard, autres) réduisent le NET sans toucher au brut", async () => {
    const sans = (await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${employeeId}/payslip?period=${period}`, headers: { cookie } })).json();
    const avec = (await app.inject({
      method: "GET",
      url: `/api/v1/payroll/employees/${employeeId}/payslip?period=${period}&avance=10000&pret=25000&retard=2250&autres=1750`,
      headers: { cookie },
    })).json();
    // Total des retenues internes = somme exacte des postes saisis.
    expect(avec.payslip.total_retenues_internes).toBe(10000 + 25000 + 2250 + 1750);
    // Le NET baisse d'autant ; le brut et les cotisations salariales sont inchangés.
    expect(avec.payslip.salaire_brut).toBe(sans.payslip.salaire_brut);
    expect(avec.payslip.total_retenues_salariales).toBe(sans.payslip.total_retenues_salariales);
    expect(avec.payslip.net_a_payer).toBe(sans.payslip.net_a_payer - 39000);
  });
});
