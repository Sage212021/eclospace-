import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Lignes LIBRES du bulletin (RH) : gains imposables ajoutés au brut, retenues
// nettes retirées du net — rien codé en dur (décision opérateur 12/08/2026).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const PERIOD = "2033-04"; // période dédiée (DB de test partagée)

describe("bulletin : lignes libres (gains imposables / retenues nettes)", () => {
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
    const existing = await prisma.payrollRateSet.findFirst({ where: { effectiveFrom: new Date("2033-01-01T00:00:00.000Z") } });
    if (!existing) {
      await prisma.payrollRateSet.create({
        data: {
          effectiveFrom: new Date("2033-01-01T00:00:00.000Z"), label: "Barème lignes libres",
          vidSalPct: 0.042, vidPatPct: 0.042, pfPct: 0.07, atPct: 0.025, cnpsCeiling: 750000,
          abatPct: 0.3, abatFixe: 500000, cacPct: 0.1, cfcSalPct: 0.01, cfcPatPct: 0.015, fnePct: 0.01,
          coefAssiette: 0.8, heuresMois: 173.33, ancDefPct: 0.05,
          irppT1Ceiling: 2000000, irppT1Pct: 0.1, irppT2Ceiling: 3000000, irppT2Pct: 0.15,
          irppT3Ceiling: 5000000, irppT3Pct: 0.25, irppT4Pct: 0.35,
          tcRavSeuil1: 110000, tc1: 0, rav1: 1950, tcRavSeuil2: 200000, tc2: 500, rav2: 1950, tc3: 750, rav3: 3250,
        },
      });
    }
    const e = await prisma.employee.create({ data: { firstName: "Ligne", lastName: "Libre" } });
    emp = e.id;
    await app.inject({
      method: "PUT", url: `/api/v1/payroll/employees/${emp}/profile`, headers: { cookie },
      payload: { gross_contractual: 400000, base_pct: 0.6, fiscal_parts: 1, apply_fiscal_parts: true, seniority_years: 0, apply_seniority: false },
    });
    await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/prepare`, headers: { cookie } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const line = (l: { employee_id: string }) => l.employee_id === emp;
  const get = async () => (await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${PERIOD}`, headers: { cookie } })).json();
  const base = { primes: 0, heures_sup: 0, retenue_absence: 0, retard: 0, avance: 0, pret: 0, sanction: 0, autres: 0 };

  it("une retenue libre diminue le net d'exactement son montant", async () => {
    const before = (await get()).lines.find(line);
    await app.inject({
      method: "PATCH", url: `/api/v1/payroll/monthly/${PERIOD}/lines/${emp}`, headers: { cookie },
      payload: { ...base, extra_lines: [{ label: "Retenue mutuelle", kind: "retenue", amount: 5000 }] },
    });
    const after = (await get()).lines.find(line);
    expect(after.net_a_payer).toBe(before.net_a_payer - 5000);
    expect(after.extra_lines).toHaveLength(1);
    expect(after.extra_lines[0].label).toBe("Retenue mutuelle");
  });

  it("un gain libre augmente le brut de son montant (imposable)", async () => {
    const before = (await get()).lines.find(line);
    await app.inject({
      method: "PATCH", url: `/api/v1/payroll/monthly/${PERIOD}/lines/${emp}`, headers: { cookie },
      payload: { ...base, extra_lines: [{ label: "Indemnité de transport", kind: "gain", amount: 10000 }] },
    });
    const after = (await get()).lines.find(line);
    // Le brut augmente d'exactement le gain ; le net augmente (moins les cotisations).
    expect(after.salaire_brut).toBe(before.salaire_brut + 10000);
    expect(after.net_a_payer).toBeGreaterThan(before.net_a_payer);
  });
});
