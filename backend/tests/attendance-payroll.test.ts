import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Consolidation vers la paie (incrément 6) — le module fournit des données, il
// ne modifie jamais un bulletin (§28). Workflow : préparer → valider → geler →
// transmettre (vers les variables de paie existantes).

describe("consolidation paie", () => {
  let app: FastifyInstance;
  let cookie: string;
  let employeeId: string;
  const PERIOD = "2026-06";

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));

    const emp = await prisma.employee.create({ data: { firstName: "Paie", lastName: "Cible" } });
    employeeId = emp.id;
    // Mardi 2026-06-02 : arrivée locale 09:00 (retard 30), départ local 17:00.
    await prisma.attendanceEvent.createMany({
      data: [
        { userId: admin.id, employeeId, kind: "in", occurredAt: new Date("2026-06-02T08:00:00.000Z") },
        { userId: admin.id, employeeId, kind: "out", occurredAt: new Date("2026-06-02T16:00:00.000Z") },
      ],
    });
    // Barème en vigueur avant juin (le défaut du seed n'entre en vigueur qu'à la date du seed).
    await prisma.deductionRule.create({ data: { perHalfHour: 500, perHour: 1000, method: "prorata", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), label: "Barème test paie" } });
    // La base de test n'est pas réinitialisée entre les exécutions : on repart de
    // périodes fraîches (cascade sur les lignes) pour ces clés fixes.
    await prisma.attendancePayrollPeriod.deleteMany({ where: { periodKey: { in: [PERIOD, "2026-07"] } } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("expose les rubriques (§29) et permet de basculer le mode (§28)", async () => {
    const rub = await app.inject({ method: "GET", url: "/api/v1/attendance/payroll/rubrics", headers: { cookie } });
    expect(rub.statusCode).toBe(200);
    expect(rub.json().find((r: { code: string }) => r.code === "heures_travaillees").enabled).toBe(true);

    const put = await app.inject({ method: "PUT", url: "/api/v1/attendance/payroll/mode", headers: { cookie }, payload: { mode: "auto" } });
    expect(put.statusCode).toBe(200);
    expect(put.json().mode).toBe("auto");
  });

  it("prépare la consolidation et fige un instantané par employé", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/attendance/payroll/${PERIOD}/prepare`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().lines).toBeGreaterThan(0);

    const sum = await app.inject({ method: "GET", url: `/api/v1/attendance/payroll/${PERIOD}`, headers: { cookie } });
    expect(sum.statusCode).toBe(200);
    const body = sum.json();
    expect(body.status).toBe("brouillon");
    const line = body.lines.find((l: { employee_id: string }) => l.employee_id === employeeId);
    expect(line.late_minutes).toBe(30);
    expect(line.deduction_proposed).toBeGreaterThan(0);
  });

  it("refuse de geler avant validation (409)", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/attendance/payroll/${PERIOD}/freeze`, headers: { cookie } });
    expect(res.statusCode).toBe(409);
  });

  it("valide, gèle, puis refuse une nouvelle préparation (409)", async () => {
    expect((await app.inject({ method: "POST", url: `/api/v1/attendance/payroll/${PERIOD}/validate`, headers: { cookie } })).json().status).toBe("valide");
    expect((await app.inject({ method: "POST", url: `/api/v1/attendance/payroll/${PERIOD}/freeze`, headers: { cookie } })).json().status).toBe("gele");
    const reprepare = await app.inject({ method: "POST", url: `/api/v1/attendance/payroll/${PERIOD}/prepare`, headers: { cookie } });
    expect(reprepare.statusCode).toBe(409);
  });

  it("transmet vers les variables de paie (rubriques activées)", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/attendance/payroll/${PERIOD}/transmit`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("transmis");

    const pv = await prisma.payrollVariable.findUnique({ where: { employeeId_periodKey: { employeeId, periodKey: PERIOD } } });
    expect(pv).toBeTruthy();
    expect(pv!.exportedAt).not.toBeNull();
    expect(Number(pv!.deductionAmount)).toBeGreaterThan(0); // rubrique « retenues » active
    expect(pv!.presenceDays).not.toBeNull(); // rubrique « heures travaillées » active
  });

  it("désactiver une rubrique l'exclut de la transmission suivante", async () => {
    // Désactive les retenues, puis reprépare une AUTRE période et transmet.
    await app.inject({ method: "PATCH", url: "/api/v1/attendance/payroll/rubrics/retenues", headers: { cookie }, payload: { enabled: false } });
    const P2 = "2026-07";
    await app.inject({ method: "POST", url: `/api/v1/attendance/payroll/${P2}/prepare`, headers: { cookie } });
    await app.inject({ method: "POST", url: `/api/v1/attendance/payroll/${P2}/validate`, headers: { cookie } });
    await app.inject({ method: "POST", url: `/api/v1/attendance/payroll/${P2}/freeze`, headers: { cookie } });
    await app.inject({ method: "POST", url: `/api/v1/attendance/payroll/${P2}/transmit`, headers: { cookie } });
    const pv = await prisma.payrollVariable.findUnique({ where: { employeeId_periodKey: { employeeId, periodKey: P2 } } });
    expect(pv!.deductionAmount).toBeNull(); // retenues désactivées → non transmises
    // Réactive pour ne pas perturber d'autres exécutions.
    await app.inject({ method: "PATCH", url: "/api/v1/attendance/payroll/rubrics/retenues", headers: { cookie }, payload: { enabled: true } });
  });
});
