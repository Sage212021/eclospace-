import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import { computePayslip, type PayrollRates, type PayslipInput } from "../src/lib/payrollEngine.js";

// Moteur de calcul de paie (D-007, incrément 3) — vérifié au centime contre un
// calcul à la main reproduisant les formules du classeur.

const RATES: PayrollRates = {
  vidSal: 0.042, vidPat: 0.042, pf: 0.07, at: 0.025, cnpsCeiling: 750000,
  coefAssiette: 0.8, abatPct: 0.3, abatFixe: 500000, cacPct: 0.1,
  cfcSal: 0.01, cfcPat: 0.015, fne: 0.01, ancDefPct: 0.05,
  irpp: { p1: 2000000, t1: 0.1, p2: 3000000, t2: 0.15, p3: 5000000, t3: 0.25, t4: 0.35 },
  tcRav: { seuil1: 110000, tc1: 0, rav1: 1950, seuil2: 200000, tc2: 500, rav2: 1950, tc3: 750, rav3: 3250 },
};

const BASE_INPUT: PayslipInput = {
  base: 300000,
  complements: 200000,
  fiscalBase: 500000,
  fiscalParts: 1,
  applyFiscalParts: true,
  seniorityYears: 0,
  seniorityRate: null,
  seniorityThreshold: 0,
  applySeniority: false,
  retenueAbsence: 0,
  internal: { avance: 0, pret: 0, retard: 0, autres: 0 },
};

describe("computePayslip — brut 500 000, 1 part", () => {
  const p = computePayslip(BASE_INPUT, RATES);

  it("salaire brut = 500 000", () => expect(p.salaire_brut).toBe(500000));
  it("assiette CNPS plafonnée = 400 000 (500 000 × 0,8)", () => expect(p.assiette_cnps).toBe(400000));
  it("PVID salarié = 16 800 ; patronal = 16 800", () => {
    expect(p.pvid_salarie).toBe(16800);
    expect(p.pvid_patronal).toBe(16800);
  });
  it("PF = 28 000 ; AT = 10 000", () => {
    expect(p.prestations_familiales).toBe(28000);
    expect(p.accidents_travail).toBe(10000);
  });
  it("CFC 5 000 / 7 500 ; FNE 5 000", () => {
    expect(p.cfc_salarie).toBe(5000);
    expect(p.cfc_patronal).toBe(7500);
    expect(p.fne).toBe(5000);
  });
  it("TC = 750 ; RAV = 3 250 (tranche > 200 000)", () => {
    expect(p.taxe_communale).toBe(750);
    expect(p.rav).toBe(3250);
  });
  it("base IRPP annuelle = 3 700 000 ; IRPP+CAC = 48 125", () => {
    expect(p.base_irpp_annuelle).toBe(3700000);
    expect(p.irpp_cac).toBe(48125);
  });
  it("total retenues salariales = 73 925", () => expect(p.total_retenues_salariales).toBe(73925));
  it("total charges patronales = 67 300", () => expect(p.total_charges_patronales).toBe(67300));
  it("NET À PAYER = 426 075", () => expect(p.net_a_payer).toBe(426075));
  it("COÛT EMPLOYEUR = 567 300", () => expect(p.cout_employeur).toBe(567300));
});

describe("computePayslip — variantes", () => {
  it("prime d'ancienneté appliquée (5 % de la base) augmente le brut", () => {
    const p = computePayslip({ ...BASE_INPUT, applySeniority: true, seniorityYears: 3, seniorityThreshold: 2 }, RATES);
    expect(p.prime_anciennete).toBe(15000); // 300 000 × 5 %
    expect(p.salaire_brut).toBe(515000);
  });
  it("retenue d'absence réduit le brut et l'assiette", () => {
    const p = computePayslip({ ...BASE_INPUT, retenueAbsence: 50000 }, RATES);
    expect(p.salaire_brut).toBe(450000);
    expect(p.assiette_fiscale).toBe(450000);
  });
  it("2 parts fiscales réduisent l'IRPP", () => {
    const one = computePayslip(BASE_INPUT, RATES).irpp_cac;
    const two = computePayslip({ ...BASE_INPUT, fiscalParts: 2 }, RATES).irpp_cac;
    expect(two).toBeLessThan(one);
  });
});

describe("intégration endpoint /payslip", () => {
  let app: FastifyInstance;
  let cookie: string;
  let employeeId: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
    const emp = await prisma.employee.create({ data: { firstName: "Bulletin", lastName: "Test" } });
    employeeId = emp.id;
    // Barème en vigueur avant la période testée.
    await prisma.payrollRateSet.create({
      data: {
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), label: "Barème test moteur",
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

  it("refuse le calcul sans fiche paie (409)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${employeeId}/payslip?period=2026-06`, headers: { cookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("no_profile");
  });

  it("calcule le bulletin après saisie de la fiche paie", async () => {
    await app.inject({
      method: "PUT",
      url: `/api/v1/payroll/employees/${employeeId}/profile`,
      headers: { cookie },
      payload: { gross_contractual: 500000, base_pct: 0.6, fiscal_parts: 1, apply_fiscal_parts: true, seniority_years: 0, apply_seniority: false },
    });
    const res = await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${employeeId}/payslip?period=2026-06`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const p = res.json().payslip;
    expect(p.net_a_payer).toBe(426075);
    expect(p.cout_employeur).toBe(567300);
  });
});
