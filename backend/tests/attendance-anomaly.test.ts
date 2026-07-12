import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import { canTransition, detectAnomalies, nextStatus } from "../src/lib/attendanceAnomaly.js";
import type { DayResult } from "../src/lib/attendanceCompute.js";

// Anomalies & workflow de validation (incrément 4).

function makeDay(over: Partial<DayResult>): DayResult {
  return {
    date: "2026-04-07",
    is_working_day: true,
    is_holiday: false,
    has_data: true,
    first_in_min: 510,
    last_out_min: 1080,
    presence_minutes: 510,
    worked_minutes: 510,
    expected_minutes: 510,
    late_minutes: 0,
    early_leave_minutes: 0,
    overtime_minutes: 0,
    interruption_minutes: 0,
    absent_full_day: false,
    justified: false,
    nature: null,
    ...over,
  };
}

describe("detectAnomalies (§19)", () => {
  it("repère retard important, départ anticipé et absence", () => {
    const days = [
      makeDay({ date: "2026-04-07", late_minutes: 40 }),
      makeDay({ date: "2026-04-08", early_leave_minutes: 30 }),
      makeDay({ date: "2026-04-09", absent_full_day: true, has_data: false }),
    ];
    const found = detectAnomalies(days, { lateMin: 15, earlyMin: 15 });
    expect(found.map((a) => a.type).sort()).toEqual(["absence", "depart_anticipe", "retard"]);
  });

  it("ignore un retard sous le seuil et les jours justifiés", () => {
    const days = [
      makeDay({ date: "2026-04-07", late_minutes: 5 }),
      makeDay({ date: "2026-04-08", absent_full_day: true, has_data: false, justified: true, nature: "conge" }),
    ];
    expect(detectAnomalies(days, { lateMin: 15, earlyMin: 15 })).toHaveLength(0);
  });
});

describe("machine à états (§23-25)", () => {
  it("autorise valider depuis en_attente / en_analyse", () => {
    expect(canTransition("en_attente", "valider")).toBe(true);
    expect(canTransition("en_analyse", "valider")).toBe(true);
    expect(nextStatus("valider")).toBe("validee");
  });
  it("refuse toute décision sur un statut terminal", () => {
    expect(canTransition("validee", "rejeter")).toBe(false);
    expect(canTransition("annulee", "valider")).toBe(false);
  });
});

describe("intégration anomalies", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let employeeCookie: string;
  let employeeId: string;
  let anomalyId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const resA = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    adminCookie = extractSessionCookie(resA.cookies.map((c) => `${c.name}=${c.value}`));

    const emp = await prisma.employee.create({ data: { firstName: "Anom", lastName: "Test" } });
    employeeId = emp.id;
    const u = await createUserWithRole("anom_employe", "CORRECTEUR", "AnomPass123!");
    await prisma.user.update({ where: { id: u.id }, data: { employeeId: emp.id } });
    const resE = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "anom_employe", password: "AnomPass123!" } });
    employeeCookie = extractSessionCookie(resE.cookies.map((c) => `${c.name}=${c.value}`));

    // Pointage : arrivée locale 09:30 (retard 60) le mardi 2026-04-07.
    await prisma.attendanceEvent.createMany({
      data: [
        { userId: admin.id, employeeId, kind: "in", occurredAt: new Date("2026-04-07T08:30:00.000Z") }, // local 09:30
        { userId: admin.id, employeeId, kind: "out", occurredAt: new Date("2026-04-07T17:00:00.000Z") }, // local 18:00
      ],
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("un employé ne peut pas scanner (403)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/attendance/anomalies/scan?employee_id=${employeeId}&from=2026-04-01&to=2026-04-30`,
      headers: { cookie: employeeCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it("RH scanne et crée l'anomalie de retard (idempotent)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/attendance/anomalies/scan?employee_id=${employeeId}&from=2026-04-01&to=2026-04-30`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBeGreaterThanOrEqual(1);
    // Second passage : rien de nouveau.
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/attendance/anomalies/scan?employee_id=${employeeId}&from=2026-04-01&to=2026-04-30`,
      headers: { cookie: adminCookie },
    });
    expect(again.json().created).toBe(0);
  });

  it("l'employé voit sa propre anomalie et la justifie", async () => {
    const list = await app.inject({ method: "GET", url: "/api/v1/attendance/anomalies", headers: { cookie: employeeCookie } });
    expect(list.statusCode).toBe(200);
    const rows = list.json();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    anomalyId = rows[0].id;
    const just = await app.inject({
      method: "POST",
      url: `/api/v1/attendance/anomalies/${anomalyId}/justify`,
      headers: { cookie: employeeCookie },
      payload: { motif: "Panne Internet", comment: "Connexion impossible avant 09:30" },
    });
    expect(just.statusCode).toBe(200);
    expect(just.json().status).toBe("en_analyse");
  });

  it("l'employé ne peut pas décider (403)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/attendance/anomalies/${anomalyId}/decision`,
      headers: { cookie: employeeCookie },
      payload: { action: "valider" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("RH valide l'anomalie ; toute décision ultérieure est refusée (409)", async () => {
    const ok = await app.inject({
      method: "POST",
      url: `/api/v1/attendance/anomalies/${anomalyId}/decision`,
      headers: { cookie: adminCookie },
      payload: { action: "valider", comment: "Justificatif accepté" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("validee");
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/attendance/anomalies/${anomalyId}/decision`,
      headers: { cookie: adminCookie },
      payload: { action: "rejeter" },
    });
    expect(again.statusCode).toBe(409);
  });

  it("expose les niveaux de validation paramétrables", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/attendance/validation-levels", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const levels = res.json();
    expect(levels.map((l: { code: string }) => l.code)).toEqual(["chef", "rh", "raf", "dg"]);
    // Rendre le RAF désactivé, puis vérifier.
    const put = await app.inject({ method: "PUT", url: "/api/v1/attendance/validation-levels/raf", headers: { cookie: adminCookie }, payload: { mode: "desactive" } });
    expect(put.statusCode).toBe(200);
    expect(put.json().mode).toBe("desactive");
  });
});
