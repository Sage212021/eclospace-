import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Livre de paie & clôture mensuelle (D-007, incrément 5).

// Période unique par exécution (base de test persistante ; period_key est unique).
const PERIOD = `2${500 + Math.floor(Math.random() * 400)}-03`;

describe("livre de paie & clôture", () => {
  let app: FastifyInstance;
  let cookie: string;
  let employeeId: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
    const emp = await prisma.employee.create({ data: { firstName: "Livre", lastName: `Paie${Math.random().toString(36).slice(2, 5)}` } });
    employeeId = emp.id;
    await app.inject({
      method: "PUT",
      url: `/api/v1/payroll/employees/${employeeId}/profile`,
      headers: { cookie },
      payload: { gross_contractual: 500000, base_pct: 0.6, fiscal_parts: 1, apply_fiscal_parts: true, seniority_years: 0, apply_seniority: false },
    });
    // D-041 : le livre de paie d'un mois ne contient que les salariés dont la paie
    // a été créée pour ce mois → on PRÉPARE explicitement la période.
    await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/prepare`, headers: { cookie } });
    // La clôture n'est permise qu'après VALIDATION du DG : on soumet puis on
    // valide (admin = ADMIN_GENERAL) avant les tests de clôture.
    await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/submit`, headers: { cookie } });
    await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/validate`, headers: { cookie } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("le livre de paie liste les salariés avec fiche et des totaux", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/payroll/register?period=${PERIOD}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.closed).toBe(false);
    const mine = b.lines.find((l: { employee_id: string }) => l.employee_id === employeeId);
    expect(mine).toBeTruthy();
    expect(mine.net_a_payer).toBeGreaterThan(0);
    expect(b.totals.brut).toBeGreaterThan(0);
  });

  it("clôture la période et archive le journal (immuable)", async () => {
    const close = await app.inject({ method: "POST", url: `/api/v1/payroll/register/${PERIOD}/close`, headers: { cookie } });
    expect(close.statusCode).toBe(200);
    expect(close.json().employees).toBeGreaterThan(0);

    const journal = await app.inject({ method: "GET", url: `/api/v1/payroll/journal/${PERIOD}`, headers: { cookie } });
    expect(journal.statusCode).toBe(200);
    const jb = journal.json();
    const mine = jb.lines.find((l: { employee_id: string }) => l.employee_id === employeeId);
    expect(mine).toBeTruthy();
    expect(mine.net_a_payer).toBeGreaterThan(0);
    expect(mine.pvid_salarie).toBeGreaterThan(0);
  });

  it("le livre indique la période comme clôturée", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/payroll/register?period=${PERIOD}`, headers: { cookie } });
    expect(res.json().closed).toBe(true);
  });

  it("refuse une seconde clôture de la même période (409)", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/payroll/register/${PERIOD}/close`, headers: { cookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("already_closed");
  });

  it("journal d'une période non clôturée → 404", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/payroll/journal/2099-11`, headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });
});

// Garde : la clôture est refusée tant que le DG n'a pas validé la paie du mois.
describe("clôture refusée avant validation du DG", () => {
  let app: FastifyInstance;
  let cookie: string;
  const PERIOD = `2${500 + Math.floor(Math.random() * 400)}-07`;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
    const emp = await prisma.employee.create({ data: { firstName: "Garde", lastName: `Cloture${Math.random().toString(36).slice(2, 5)}` } });
    await app.inject({
      method: "PUT", url: `/api/v1/payroll/employees/${emp.id}/profile`, headers: { cookie },
      payload: { gross_contractual: 400000, base_pct: 0.6, fiscal_parts: 1, apply_fiscal_parts: true, seniority_years: 0, apply_seniority: false },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("refuse la clôture d'un mois seulement PRÉPARÉ (brouillon, non validé) — 409 not_validated_by_dg", async () => {
    await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/prepare`, headers: { cookie } });
    const res = await app.inject({ method: "POST", url: `/api/v1/payroll/register/${PERIOD}/close`, headers: { cookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("not_validated_by_dg");
    // La paie du mois n'est PAS clôturée.
    const reg = await app.inject({ method: "GET", url: `/api/v1/payroll/register?period=${PERIOD}`, headers: { cookie } });
    expect(reg.json().closed).toBe(false);
  });

  it("refuse la clôture d'un mois SOUMIS au DG mais pas encore validé — 409", async () => {
    await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/submit`, headers: { cookie } });
    const res = await app.inject({ method: "POST", url: `/api/v1/payroll/register/${PERIOD}/close`, headers: { cookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("not_validated_by_dg");
  });

  it("autorise la clôture une fois le mois VALIDÉ par le DG", async () => {
    await app.inject({ method: "POST", url: `/api/v1/payroll/monthly/${PERIOD}/validate`, headers: { cookie } });
    const res = await app.inject({ method: "POST", url: `/api/v1/payroll/register/${PERIOD}/close`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().employees).toBeGreaterThan(0);
  });
});
