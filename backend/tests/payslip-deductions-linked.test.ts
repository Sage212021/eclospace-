import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Les retenues du bulletin unitaire et celles de la grille mensuelle sont le MÊME
// enregistrement (payroll_monthly_lines) : ni double saisie, ni divergence.

describe("retenues bulletin ↔ grille mensuelle (source unique)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let employeeId: string;
  const period = "2032-06";

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
    await prisma.payrollMonthlyRun.deleteMany({ where: { periodKey: period } });
    const emp = await prisma.employee.create({ data: { firstName: "Lien", lastName: "Retenues" } });
    employeeId = emp.id;
    await prisma.payrollEmployeeProfile.create({ data: { employeeId, grossContractual: 300000, basePct: 1, fiscalParts: 1, applyFiscalParts: true, seniorityYears: 0, applySeniority: false } });
  });

  afterAll(async () => {
    await prisma.payrollMonthlyRun.deleteMany({ where: { periodKey: period } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  const ded = (extra = "") => app.inject({ method: "GET", url: `/api/v1/payroll/employees/${employeeId}/deductions?period=${period}${extra}`, headers: { cookie } });

  it("renvoie 0 et statut null tant qu'aucun mois n'est ouvert", async () => {
    const b = (await ded()).json();
    expect(b.saved).toBe(false);
    expect(b.status).toBeNull();
    expect(b.locked).toBe(false);
    expect([b.retenue_absence, b.avance, b.pret, b.retard, b.autres]).toEqual([0, 0, 0, 0, 0]);
  });

  it("l'enregistrement au bulletin ouvre le mois (brouillon) et écrit dans la grille", async () => {
    const put = await app.inject({ method: "PUT", url: `/api/v1/payroll/employees/${employeeId}/deductions`, headers: { cookie }, payload: { period, pret: 25000, retard: 2250 } });
    expect(put.statusCode).toBe(200);
    expect(put.json().status).toBe("brouillon");

    // Un run mensuel existe et la ligne du salarié porte bien les montants.
    const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period } });
    expect(run).not.toBeNull();
    const line = await prisma.payrollMonthlyLine.findUnique({ where: { runId_employeeId: { runId: run!.id, employeeId } } });
    expect(Number(line!.pret)).toBe(25000);
    expect(Number(line!.retard)).toBe(2250);

    const g = (await ded()).json();
    expect(g.saved).toBe(true);
    expect(g.pret).toBe(25000);
  });

  it("primes et heures sup saisies au bulletin sont écrites dans la grille (imposables)", async () => {
    const put = await app.inject({ method: "PUT", url: `/api/v1/payroll/employees/${employeeId}/deductions`, headers: { cookie }, payload: { period, primes: 15000, heures_sup: 8000, pret: 25000, retard: 2250 } });
    expect(put.statusCode).toBe(200);
    const body = put.json();
    expect(body.primes).toBe(15000);
    expect(body.heures_sup).toBe(8000);

    const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period } });
    const line = await prisma.payrollMonthlyLine.findUnique({ where: { runId_employeeId: { runId: run!.id, employeeId } } });
    expect(Number(line!.primes)).toBe(15000);
    expect(Number(line!.heuresSup)).toBe(8000);

    const g = (await ded()).json();
    expect(g.primes).toBe(15000);
    expect(g.heures_sup).toBe(8000);
  });

  it("une modification dans la grille se reflète dans le bulletin (bidirectionnel)", async () => {
    await app.inject({
      method: "PATCH", url: `/api/v1/payroll/monthly/${period}/lines/${employeeId}`, headers: { cookie },
      payload: { primes: 0, heures_sup: 0, retenue_absence: 0, retard: 2250, avance: 5000, pret: 25000, sanction: 3000, autres: 0 },
    });
    const g = (await ded()).json();
    expect(g.avance).toBe(5000);
    expect(g.sanction).toBe(3000); // sanction saisie dans la grille, visible en lecture ici
  });

  it("mois soumis au DG : verrou en lecture et refus d'écriture (409)", async () => {
    await prisma.payrollMonthlyRun.update({ where: { periodKey: period }, data: { status: "soumis_dg" } });
    const g = (await ded()).json();
    expect(g.locked).toBe(true);
    expect(g.status).toBe("soumis_dg");

    const put = await app.inject({ method: "PUT", url: `/api/v1/payroll/employees/${employeeId}/deductions`, headers: { cookie }, payload: { period, pret: 999 } });
    expect(put.statusCode).toBe(409);
    expect(put.json().code).toBe("run_submitted");
  });
});
