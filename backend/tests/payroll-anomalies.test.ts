import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Contrôles & anomalies (§18) : une anomalie bloquante (salaire de base nul)
// empêche la soumission au DG ; une fois corrigée, la soumission passe.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const PERIOD = "2034-05";

describe("contrôles & anomalies avant soumission DG", () => {
  let app: FastifyInstance;
  let cookie: string;
  let emp: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));

    const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: PERIOD } });
    if (run) {
      await prisma.payrollMonthlyLine.deleteMany({ where: { runId: run.id } });
      await prisma.payrollMonthlyRun.delete({ where: { id: run.id } });
    }
    if (!(await prisma.payrollRateSet.findFirst({ where: { effectiveFrom: new Date("2034-01-01T00:00:00.000Z") } }))) {
      await prisma.payrollRateSet.create({
        data: {
          effectiveFrom: new Date("2034-01-01T00:00:00.000Z"), label: "Barème anomalies",
          vidSalPct: 0.042, vidPatPct: 0.042, pfPct: 0.07, atPct: 0.025, cnpsCeiling: 750000,
          abatPct: 0.3, abatFixe: 500000, cacPct: 0.1, cfcSalPct: 0.01, cfcPatPct: 0.015, fnePct: 0.01,
          coefAssiette: 0.8, heuresMois: 173.33, ancDefPct: 0.05,
          irppT1Ceiling: 2000000, irppT1Pct: 0.1, irppT2Ceiling: 3000000, irppT2Pct: 0.15,
          irppT3Ceiling: 5000000, irppT3Pct: 0.25, irppT4Pct: 0.35,
          tcRavSeuil1: 110000, tc1: 0, rav1: 1950, tcRavSeuil2: 200000, tc2: 500, rav2: 1950, tc3: 750, rav3: 3250,
        },
      });
    }
    const e = await prisma.employee.create({ data: { firstName: "Anomalie", lastName: "Test", status: "salarie" } });
    emp = e.id;
    // Fiche paie avec salaire de base NUL → anomalie bloquante.
    await app.inject({
      method: "PUT", url: `/api/v1/payroll/employees/${emp}/profile`, headers: { cookie },
      payload: { gross_contractual: 0, base_pct: 0.6, fiscal_parts: 1, apply_fiscal_parts: true, seniority_years: 0, apply_seniority: false },
    });
    // Mois isolé à ce seul salarié (base de test partagée : `prepare` prendrait
    // tous les salariés dotés d'une fiche et fausserait le contrôle du mois).
    const created = await prisma.payrollMonthlyRun.create({ data: { periodKey: PERIOD, preparedBy: null } });
    await prisma.payrollMonthlyLine.create({ data: { runId: created.id, employeeId: emp } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("détecte l'anomalie bloquante (salaire de base nul) et refuse la soumission", async () => {
    const an = (await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${PERIOD}/anomalies`, headers: { cookie } })).json();
    expect(an.can_submit).toBe(false);
    expect(an.blocking.some((a: { employee_id: string }) => a.employee_id === emp)).toBe(true);

    const sub = await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/submit`, headers: { cookie } });
    expect(sub.statusCode).toBe(409);
    expect(sub.json().code).toBe("anomalies_blocking");
  });

  it("après correction du salaire, la soumission est autorisée", async () => {
    await app.inject({
      method: "PUT", url: `/api/v1/payroll/employees/${emp}/profile`, headers: { cookie },
      payload: { gross_contractual: 300000, base_pct: 0.6, fiscal_parts: 1, apply_fiscal_parts: true, seniority_years: 0, apply_seniority: false },
    });
    const an = (await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${PERIOD}/anomalies`, headers: { cookie } })).json();
    expect(an.blocking.some((a: { employee_id: string }) => a.employee_id === emp)).toBe(false);

    const sub = await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/submit`, headers: { cookie } });
    expect(sub.statusCode).toBe(200);
    expect(sub.json().status).toBe("soumis_dg");
  });
});
