import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Niveau 2, étape B : une rubrique ACTIVE saisie sur le bulletin est traitée
// automatiquement selon son statut fiscal/CNPS (le document fait foi) :
//  • taxable + cotisable  → entre dans le brut, l'assiette fiscale ET l'assiette CNPS ;
//  • exonérée (transport) → entre dans le brut mais PAS dans l'IRPP ni la CNPS.
// La structure du bulletin ne change pas ; sans rubrique, le calcul est identique.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const period = "2034-03";

describe("bulletin — traitement automatique des rubriques activées", () => {
  let app: FastifyInstance;
  let cookie: string;
  let employeeId: string;

  const setInForce = (code: string, on: boolean) =>
    app.inject({ method: "PATCH", url: `/api/v1/payroll/salary-elements/${code}`, headers: { cookie }, payload: { in_force: on } });

  type Line = { label: string; kind: "gain" | "retenue"; amount: number; element_code?: string; bareme_type?: string; quantity?: number };
  async function saveLine(extra_lines: Line[]) {
    // S'assure que le mois est ouvert (crée le run + la ligne), puis écrit les lignes.
    await app.inject({ method: "PUT", url: `/api/v1/payroll/employees/${employeeId}/deductions`, headers: { cookie }, payload: { period, retenue_absence: 0 } });
    await app.inject({ method: "PATCH", url: `/api/v1/payroll/monthly/${period}/lines/${employeeId}`, headers: { cookie }, payload: { primes: 0, heures_sup: 0, retenue_absence: 0, retard: 0, avance: 0, pret: 0, sanction: 0, autres: 0, extra_lines } });
    const month = await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${period}`, headers: { cookie } });
    const row = (month.json().lines as { employee_id: string; payslip: { salaire_brut: number; assiette_fiscale: number; assiette_cnps: number; avantages_nature: number } }[]).find((r) => r.employee_id === employeeId);
    if (!row) throw new Error("ligne introuvable");
    return row.payslip;
  }

  async function anBaremePct(type: string): Promise<number> {
    const month = await app.inject({ method: "GET", url: `/api/v1/payroll/monthly/${period}`, headers: { cookie } });
    return (month.json().rates.avantages_nature as Record<string, number>)[type];
  }

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
    const emp = await prisma.employee.create({ data: { firstName: "Rubrique", lastName: "Bulletin" } });
    employeeId = emp.id;
    await prisma.payrollEmployeeProfile.create({ data: { employeeId, grossContractual: 300000, basePct: 1, fiscalParts: 1, applyFiscalParts: true, seniorityYears: 0, applySeniority: false } });
    await setInForce("prime_technicite", true); // taxable + cotisable
    await setInForce("prime_transport", true); // non taxable + non cotisable
    await setInForce("avantages_nature", true); // avantage en nature (barème)
  });

  afterAll(async () => {
    await setInForce("prime_technicite", false).catch(() => {});
    await setInForce("prime_transport", false).catch(() => {});
    await setInForce("avantages_nature", false).catch(() => {});
    await prisma.payrollMonthlyRun.deleteMany({ where: { periodKey: period } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("une rubrique taxable+cotisable entre dans le brut, l'IRPP et la CNPS", async () => {
    const base0 = await saveLine([]);
    const withTech = await saveLine([{ label: "Prime de technicité", kind: "gain", amount: 50000, element_code: "prime_technicite" }]);
    expect(withTech.salaire_brut).toBe(base0.salaire_brut + 50000);
    expect(withTech.assiette_fiscale).toBe(base0.assiette_fiscale + 50000);
    expect(withTech.assiette_cnps).toBe(base0.assiette_cnps + 50000);
  });

  it("une indemnité exonérée augmente le brut mais PAS l'IRPP ni la CNPS", async () => {
    const withTech = await saveLine([{ label: "Prime de technicité", kind: "gain", amount: 50000, element_code: "prime_technicite" }]);
    const withBoth = await saveLine([
      { label: "Prime de technicité", kind: "gain", amount: 50000, element_code: "prime_technicite" },
      { label: "Prime de transport", kind: "gain", amount: 30000, element_code: "prime_transport" },
    ]);
    // Le transport s'ajoute au brut…
    expect(withBoth.salaire_brut).toBe(withTech.salaire_brut + 30000);
    // …mais n'entre ni dans l'assiette fiscale, ni dans l'assiette CNPS.
    expect(withBoth.assiette_fiscale).toBe(withTech.assiette_fiscale);
    expect(withBoth.assiette_cnps).toBe(withTech.assiette_cnps);
  });

  it("une rubrique EN ATTENTE (non activée) ne reçoit pas le traitement rubrique (ligne libre classique)", async () => {
    await setInForce("prime_transport", false); // remise en attente
    const withTech = await saveLine([{ label: "Prime de technicité", kind: "gain", amount: 50000, element_code: "prime_technicite" }]);
    const withDormant = await saveLine([
      { label: "Prime de technicité", kind: "gain", amount: 50000, element_code: "prime_technicite" },
      { label: "Transport", kind: "gain", amount: 30000, element_code: "prime_transport" },
    ]);
    // En attente : la ligne redevient un gain libre classique → imposable (entre dans l'assiette fiscale).
    expect(withDormant.assiette_fiscale).toBe(withTech.assiette_fiscale + 30000);
    await setInForce("prime_transport", true);
  });

  it("un avantage en nature au barème augmente l'IRPP et la CNPS (pas le brut), sans montant saisi", async () => {
    const base0 = await saveLine([]);
    const pct = await anBaremePct("logement"); // ex. 0,15
    const withAN = await saveLine([{ label: "Logement de fonction", kind: "gain", amount: 0, element_code: "avantages_nature", bareme_type: "logement", quantity: 1 }]);
    const eval1 = Math.round(base0.assiette_fiscale * pct); // % du brut taxable « cœur »
    expect(eval1).toBeGreaterThan(0);
    // Non payé en espèces : le brut ne bouge pas…
    expect(withAN.salaire_brut).toBe(base0.salaire_brut);
    // …mais l'assiette fiscale ET l'assiette CNPS montent de l'évaluation au barème.
    expect(withAN.assiette_fiscale).toBe(base0.assiette_fiscale + eval1);
    expect(withAN.assiette_cnps).toBe(base0.assiette_cnps + eval1);
    expect(withAN.avantages_nature).toBe(eval1);
  });

  it("la quantité multiplie l'évaluation (ex. 2 véhicules)", async () => {
    const base0 = await saveLine([]);
    const pct = await anBaremePct("vehicule");
    const with2 = await saveLine([{ label: "Véhicules de fonction", kind: "gain", amount: 0, element_code: "avantages_nature", bareme_type: "vehicule", quantity: 2 }]);
    const eval2 = Math.round(base0.assiette_fiscale * pct * 2);
    expect(with2.assiette_fiscale).toBe(base0.assiette_fiscale + eval2);
    expect(with2.salaire_brut).toBe(base0.salaire_brut);
  });
});
