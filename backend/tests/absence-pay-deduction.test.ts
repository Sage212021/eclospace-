import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Temps 2 du chantier absences : retenue de paie des absences non payées.
// Deux modes au choix du RH (interrupteur) — manuel (défaut) ou automatique
// (montant calculé : jours non payés × salaire journalier = base/30).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const period = "2033-05"; // mai 2033 (31 jours)

describe("retenue de paie des absences non payées (manuel / automatique)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let employeeId: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
    const emp = await prisma.employee.create({ data: { firstName: "Retenue", lastName: "Absence" } });
    employeeId = emp.id;
    await prisma.payrollEmployeeProfile.create({ data: { employeeId, grossContractual: 300000, basePct: 1, fiscalParts: 1, applyFiscalParts: true, seniorityYears: 0, applySeniority: false } });
    // 3 jours de mise à pied (non payée) validée + 2 jours de permission (payée).
    await prisma.absence.create({ data: { employeeId, type: "suspension", reasonCode: "mise_a_pied", status: "validee", fromDate: new Date("2033-05-10"), toDate: new Date("2033-05-12") } });
    await prisma.absence.create({ data: { employeeId, type: "permission", reasonCode: "mariage_salarie", status: "validee", fromDate: new Date("2033-05-20"), toDate: new Date("2033-05-21") } });
  });

  afterAll(async () => {
    // Restaure l'interrupteur au défaut (OFF) pour ne pas contaminer les autres suites.
    await app.inject({ method: "PUT", url: "/api/v1/payroll/absence-auto-deduction", headers: { cookie }, payload: { enabled: false } }).catch(() => {});
    await prisma.payrollMonthlyRun.deleteMany({ where: { periodKey: period } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("l'interrupteur est à OFF par défaut", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/payroll/absence-auto-deduction", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(false);
  });

  it("calcule la retenue des seuls jours NON payés (3 j × 10 000 = 30 000)", async () => {
    // base 300 000 → journalier 10 000 ; 3 jours de mise à pied ; la permission ne compte pas.
    const res = await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${employeeId}/absence-deduction?period=${period}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().days).toBe(3);
    expect(res.json().daily).toBe(10000);
    expect(res.json().amount).toBe(30000);
  });

  it("mode automatique : la grille propose le montant calculé (suggestion + pré-remplissage)", async () => {
    // OFF : pas de suggestion.
    const off = await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${employeeId}/deductions?period=${period}`, headers: { cookie } });
    expect(off.json().auto_absence_enabled).toBe(false);
    expect(off.json().suggested_retenue_absence).toBe(0);

    // ON : suggestion = 30 000.
    const put = await app.inject({ method: "PUT", url: "/api/v1/payroll/absence-auto-deduction", headers: { cookie }, payload: { enabled: true } });
    expect(put.json().enabled).toBe(true);

    const on = await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${employeeId}/deductions?period=${period}`, headers: { cookie } });
    expect(on.json().auto_absence_enabled).toBe(true);
    expect(on.json().suggested_retenue_absence).toBe(30000);
    expect(on.json().unpaid_absence_days).toBe(3);
  });

  it("mode manuel reste possible : le RH saisit sa propre valeur, qui est conservée", async () => {
    // Le RH enregistre 12 000 à la main (par ex. mise à pied partielle).
    const save = await app.inject({ method: "PUT", url: `/api/v1/payroll/employees/${employeeId}/deductions`, headers: { cookie }, payload: { period, retenue_absence: 12000 } });
    expect(save.statusCode).toBe(200);
    const back = await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${employeeId}/deductions?period=${period}`, headers: { cookie } });
    expect(back.json().retenue_absence).toBe(12000);
  });
});
