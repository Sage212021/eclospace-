import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Envoi du bulletin par e-mail (D-007, incrément 4).

describe("bulletin par e-mail", () => {
  let app: FastifyInstance;
  let cookie: string;
  let employeeId: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
    const emp = await prisma.employee.create({ data: { firstName: "Mail", lastName: "Bulletin" } });
    employeeId = emp.id;
    await prisma.payrollRateSet.create({
      data: {
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), label: "Barème test mail",
        vidSalPct: 0.042, vidPatPct: 0.042, pfPct: 0.07, atPct: 0.025, cnpsCeiling: 750000,
        abatPct: 0.3, abatFixe: 500000, cacPct: 0.1, cfcSalPct: 0.01, cfcPatPct: 0.015, fnePct: 0.01,
        coefAssiette: 0.8, heuresMois: 173.33, ancDefPct: 0.05,
        irppT1Ceiling: 2000000, irppT1Pct: 0.1, irppT2Ceiling: 3000000, irppT2Pct: 0.15,
        irppT3Ceiling: 5000000, irppT3Pct: 0.25, irppT4Pct: 0.35,
        tcRavSeuil1: 110000, tc1: 0, rav1: 1950, tcRavSeuil2: 200000, tc2: 500, rav2: 1950, tc3: 750, rav3: 3250,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("aperçu sans fiche paie → 409", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/payroll/employees/${employeeId}/payslip/email`, headers: { cookie }, payload: { period: "2026-06", preview: true } });
    expect(res.statusCode).toBe(409);
  });

  it("aperçu avec fiche paie renvoie le sujet et le destinataire par défaut (e-mail de la fiche)", async () => {
    await app.inject({
      method: "PUT",
      url: `/api/v1/payroll/employees/${employeeId}/profile`,
      headers: { cookie },
      payload: { gross_contractual: 500000, base_pct: 0.6, fiscal_parts: 1, apply_fiscal_parts: true, seniority_years: 0, apply_seniority: false, email: "salarie@example.com" },
    });
    const res = await app.inject({ method: "POST", url: `/api/v1/payroll/employees/${employeeId}/payslip/email`, headers: { cookie }, payload: { period: "2026-06", preview: true } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.subject).toContain("Bulletin de paie 2026-06");
    expect(b.default_to).toBe("salarie@example.com");
    expect(b.html).toContain("NET À PAYER");
  });

  it("envoi réel : 503 si SMTP non configuré (le flux atteint bien l'expédition)", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/payroll/employees/${employeeId}/payslip/email`, headers: { cookie }, payload: { period: "2026-06" } });
    // Environnement de test sans SMTP → 503 mail_not_configured (ou 200 si configuré).
    expect([503, 200]).toContain(res.statusCode);
    if (res.statusCode === 503) expect(res.json().code).toBe("mail_not_configured");
  });

  it("refuse un destinataire sans e-mail connu (400)", async () => {
    const emp2 = await prisma.employee.create({ data: { firstName: "Sans", lastName: "Mail" } });
    await app.inject({
      method: "PUT",
      url: `/api/v1/payroll/employees/${emp2.id}/profile`,
      headers: { cookie },
      payload: { gross_contractual: 300000, base_pct: 1, fiscal_parts: 1, apply_fiscal_parts: true, seniority_years: 0, apply_seniority: false },
    });
    const res = await app.inject({ method: "POST", url: `/api/v1/payroll/employees/${emp2.id}/payslip/email`, headers: { cookie }, payload: { period: "2026-06" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("missing_recipient");
  });
});
