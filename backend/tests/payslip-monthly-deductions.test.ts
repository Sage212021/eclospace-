import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Retenues du mois mémorisées par employé et par mois (bulletin unitaire).

describe("retenues du mois mémorisées", () => {
  let app: FastifyInstance;
  let cookie: string;
  let employeeId: string;
  const period = "2031-04";

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
    const emp = await prisma.employee.create({ data: { firstName: "Reten", lastName: "Mémoire" } });
    employeeId = emp.id;
  });

  afterAll(async () => {
    await prisma.payslipMonthlyDeduction.deleteMany({ where: { employeeId } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("renvoie 0 partout tant que rien n'est enregistré", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${employeeId}/deductions?period=${period}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.saved).toBe(false);
    expect([b.retenue_absence, b.avance, b.pret, b.retard, b.autres]).toEqual([0, 0, 0, 0, 0]);
  });

  it("enregistre les retenues puis les relit à l'identique", async () => {
    const put = await app.inject({
      method: "PUT", url: `/api/v1/payroll/employees/${employeeId}/deductions`, headers: { cookie },
      payload: { period, retenue_absence: 5000, avance: 10000, pret: 25000, retard: 2250, autres: 1750 },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().saved).toBe(true);

    const get = await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${employeeId}/deductions?period=${period}`, headers: { cookie } });
    const b = get.json();
    expect(b.saved).toBe(true);
    expect([b.retenue_absence, b.avance, b.pret, b.retard, b.autres]).toEqual([5000, 10000, 25000, 2250, 1750]);
  });

  it("réécrit (upsert) sans créer de doublon", async () => {
    await app.inject({
      method: "PUT", url: `/api/v1/payroll/employees/${employeeId}/deductions`, headers: { cookie },
      payload: { period, retenue_absence: 0, avance: 0, pret: 30000, retard: 0, autres: 0 },
    });
    const rows = await prisma.payslipMonthlyDeduction.count({ where: { employeeId, periodKey: period } });
    expect(rows).toBe(1);
    const get = (await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${employeeId}/deductions?period=${period}`, headers: { cookie } })).json();
    expect(get.pret).toBe(30000);
    expect(get.retenue_absence).toBe(0);
  });

  it("les retenues d'un mois n'affectent pas un autre mois", async () => {
    const other = (await app.inject({ method: "GET", url: `/api/v1/payroll/employees/${employeeId}/deductions?period=2031-05`, headers: { cookie } })).json();
    expect(other.saved).toBe(false);
    expect(other.pret).toBe(0);
  });
});
