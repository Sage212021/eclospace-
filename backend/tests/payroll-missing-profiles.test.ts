import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// La grille mensuelle n'affiche que les salariés dotés d'une fiche paie. Les autres
// ne doivent pas « disparaître » : ils sont remontés dans `missing_profiles`.

describe("grille de paie : salariés sans fiche paie", () => {
  let app: FastifyInstance;
  let cookie: string;
  let withProfile: string;
  let withoutProfile: string;
  const period = "2033-07";
  const tag = `MISS-${Date.now()}`;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
    await prisma.payrollMonthlyRun.deleteMany({ where: { periodKey: period } });
    await prisma.payrollRateSet.create({
      data: {
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), label: `Barème ${tag}`,
        vidSalPct: 0.042, vidPatPct: 0.042, pfPct: 0.07, atPct: 0.025, cnpsCeiling: 750000,
        abatPct: 0.3, abatFixe: 500000, cacPct: 0.1, cfcSalPct: 0.01, cfcPatPct: 0.015, fnePct: 0.01,
        coefAssiette: 0.8, heuresMois: 173.33, ancDefPct: 0.05,
        irppT1Ceiling: 2000000, irppT1Pct: 0.1, irppT2Ceiling: 3000000, irppT2Pct: 0.15,
        irppT3Ceiling: 5000000, irppT3Pct: 0.25, irppT4Pct: 0.35,
        tcRavSeuil1: 110000, tc1: 0, rav1: 1950, tcRavSeuil2: 200000, tc2: 500, rav2: 1950, tc3: 750, rav3: 3250,
      },
    });
    const a = await prisma.employee.create({ data: { firstName: `${tag}-Avec`, lastName: "Fiche" } });
    withProfile = a.id;
    await prisma.payrollEmployeeProfile.create({ data: { employeeId: withProfile, grossContractual: 300000, basePct: 1 } });
    const b = await prisma.employee.create({ data: { firstName: `${tag}-Sans`, lastName: "Fiche" } });
    withoutProfile = b.id;
  });

  afterAll(async () => {
    await prisma.payrollMonthlyRun.deleteMany({ where: { periodKey: period } }).catch(() => {});
    await prisma.payrollEmployeeProfile.deleteMany({ where: { employeeId: withProfile } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { id: { in: [withProfile, withoutProfile] } } }).catch(() => {});
    await prisma.payrollRateSet.deleteMany({ where: { label: `Barème ${tag}` } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("la grille liste le salarié avec fiche et remonte celui sans fiche dans missing_profiles", async () => {
    await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${period}/prepare`, headers: { cookie } });
    const month = (await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${period}`, headers: { cookie } })).json();

    const lineIds = (month.lines as Array<{ employee_id: string }>).map((l) => l.employee_id);
    expect(lineIds).toContain(withProfile);
    expect(lineIds).not.toContain(withoutProfile);

    const missingIds = (month.missing_profiles as Array<{ employee_id: string }>).map((m) => m.employee_id);
    expect(missingIds).toContain(withoutProfile);
    expect(missingIds).not.toContain(withProfile);
  });
});
