import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Rapports RH & tableau de bord (incrément 5).

describe("rapport mensuel & tableau de bord", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let employeeCookie: string;
  let employeeId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const resA = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    adminCookie = extractSessionCookie(resA.cookies.map((c) => `${c.name}=${c.value}`));

    const emp = await prisma.employee.create({ data: { firstName: "Report", lastName: "Cible" } });
    employeeId = emp.id;
    const u = await createUserWithRole("report_employe", "CORRECTEUR", "ReportPass123!");
    await prisma.user.update({ where: { id: u.id }, data: { employeeId: emp.id } });
    const resE = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "report_employe", password: "ReportPass123!" } });
    employeeCookie = extractSessionCookie(resE.cookies.map((c) => `${c.name}=${c.value}`));

    // Mardi 2026-05-05 : arrivée locale 09:00 (retard 30), départ local 17:00.
    await prisma.attendanceEvent.createMany({
      data: [
        { userId: admin.id, employeeId, kind: "in", occurredAt: new Date("2026-05-05T08:00:00.000Z") },
        { userId: admin.id, employeeId, kind: "out", occurredAt: new Date("2026-05-05T16:00:00.000Z") },
      ],
    });

    // Règle de retenue en vigueur AVANT la période testée (la règle par défaut
    // du seed n'entre en vigueur qu'à la date du seed, postérieure à mai).
    await prisma.deductionRule.create({
      data: { perHalfHour: 500, perHour: 1000, method: "prorata", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), label: "Barème test 2026" },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("un employé simple ne peut pas ouvrir le rapport agrégé (403)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/attendance/report/monthly?from=2026-05-01&to=2026-05-31", headers: { cookie: employeeCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("le rapport mensuel liste l'employé avec ses cumuls", async () => {
    // Période d'un jour pour une retenue déterministe (sinon les autres jours
    // ouvrables de mai comptent comme absences injustifiées).
    const res = await app.inject({ method: "GET", url: "/api/v1/attendance/report/monthly?from=2026-05-05&to=2026-05-05", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.headcount).toBeGreaterThan(0);
    const row = body.rows.find((r: { employee_id: string }) => r.employee_id === employeeId);
    expect(row).toBeTruthy();
    expect(row.late_minutes).toBe(30);
    expect(row.early_leave_minutes).toBe(60);
    expect(row.worked_minutes).toBe(420);
    // 90 min de manquement (30 retard + 60 départ anticipé) × prorata (500/30) = 1500.
    expect(row.deduction_proposed).toBe(1500);
  });

  it("le tableau de bord renvoie les indicateurs du jour", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/attendance/dashboard?date=2026-05-05", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.date).toBe("2026-05-05");
    expect(typeof b.present_today).toBe("number");
    expect(b.late_today).toBeGreaterThanOrEqual(1);
    expect(b).toHaveProperty("presence_rate_pct");
    expect(b).toHaveProperty("deduction_month_total");
  });

  it("le tableau de bord est refusé à un employé simple (403)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/attendance/dashboard", headers: { cookie: employeeCookie } });
    expect(res.statusCode).toBe(403);
  });
});
