import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import { assertScheduleCoherent, hhmmToMinutes, minutesToHhmm } from "../src/lib/attendance.js";

// Module « Présences & Temps de travail » — incrément 1 : horaires paramétrables
// et pointage persistant issu de la connexion/déconnexion.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function login(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return { res, cookie: extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`)) };
}

// Le pointage est enregistré au mieux (void) : on attend qu'il apparaisse.
async function waitForEvent(userId: string, kind: string): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    const e = await prisma.attendanceEvent.findFirst({ where: { userId, kind }, orderBy: { occurredAt: "desc" } });
    if (e) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe("présences — horaires et pointage (incrément 1)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let dept: { id: string };
  let emp1: { id: string };
  let user2Id: string;
  let user2Cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    ({ cookie: adminCookie } = await login(app, "admin", ADMIN_PASSWORD));

    dept = await prisma.department.upsert({
      where: { code: "TESTPRES" },
      update: {},
      create: { code: "TESTPRES", name: "Département test présences" },
    });
    emp1 = await prisma.employee.create({
      data: { firstName: "Test", lastName: "Employe1", departmentId: dept.id },
    });
    const emp2 = await prisma.employee.create({
      data: { firstName: "Test", lastName: "Employe2", departmentId: dept.id },
    });
    const u2 = await createUserWithRole("pres_employe2", "CORRECTEUR", "EmployePass123!");
    await prisma.user.update({ where: { id: u2.id }, data: { employeeId: emp2.id } });
    user2Id = u2.id;
    ({ cookie: user2Cookie } = await login(app, "pres_employe2", "EmployePass123!"));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("enregistre un pointage d'entrée à la connexion", async () => {
    // adminCookie a été obtenu via un login réel dans beforeAll.
    expect(await waitForEvent(adminId, "in")).toBe(true);
  });

  it("enregistre un pointage de sortie à la déconnexion", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect(await waitForEvent(adminId, "out")).toBe(true);
    // On refait un login pour disposer d'un cookie valide pour la suite.
    ({ cookie: adminCookie } = await login(app, "admin", ADMIN_PASSWORD));
  });

  it("résout l'horaire officiel par défaut de la maison (08:30-18:00, pause 12h-13h)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/attendance/work-schedule", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.day_start).toBe("08:30");
    expect(b.lunch_start).toBe("12:00");
    expect(b.lunch_end).toBe("13:00");
    expect(b.day_end).toBe("18:00");
    expect(b.source).toBe("company");
  });

  it("crée une surcharge d'horaire par employé et la résout en priorité", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/attendance/work-schedules",
      headers: { cookie: adminCookie },
      payload: {
        scope: "employee",
        employee_id: emp1.id,
        day_start: "07:00",
        lunch_start: "12:00",
        lunch_end: "12:30",
        day_end: "15:00",
        working_days: "1,2,3,4,5,6",
      },
    });
    expect(create.statusCode).toBe(201);

    const resolved = await app.inject({
      method: "GET",
      url: `/api/v1/attendance/work-schedule?employee_id=${emp1.id}`,
      headers: { cookie: adminCookie },
    });
    expect(resolved.statusCode).toBe(200);
    const b = resolved.json();
    expect(b.day_start).toBe("07:00");
    expect(b.day_end).toBe("15:00");
    expect(b.source).toBe("employee");
  });

  it("refuse un horaire incohérent (pause après la fin de journée)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/attendance/work-schedules",
      headers: { cookie: adminCookie },
      payload: { scope: "company", day_start: "08:30", lunch_start: "19:00", lunch_end: "20:00", day_end: "18:00" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("incoherent_schedule");
  });

  it("enregistre un jour férié et refuse un doublon (409)", async () => {
    // Date fixe et lointaine, NETTOYÉE avant : déterministe et idempotent, sans
    // collision sur la base de test partagée (public_holidays.day est unique).
    const day = "2199-12-25";
    await prisma.publicHoliday.deleteMany({ where: { day: new Date(`${day}T00:00:00.000Z`) } });
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/attendance/holidays",
      headers: { cookie: adminCookie },
      payload: { day, label: "Noël" },
    });
    expect(first.statusCode).toBe(201);
    const dup = await app.inject({
      method: "POST",
      url: "/api/v1/attendance/holidays",
      headers: { cookie: adminCookie },
      payload: { day, label: "Noël (doublon)" },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("holiday_exists");
  });

  it("interdit à un employé de consulter le pointage d'un autre (403)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/attendance/events?employee_id=${emp1.id}`,
      headers: { cookie: user2Cookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it("laisse un employé consulter son propre pointage", async () => {
    expect(await waitForEvent(user2Id, "in")).toBe(true);
    const res = await app.inject({ method: "GET", url: "/api/v1/attendance/events", headers: { cookie: user2Cookie } });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("présences — utilitaires de calcul horaire", () => {
  it("convertit HH:MM ↔ minutes", () => {
    expect(hhmmToMinutes("08:30")).toBe(510);
    expect(hhmmToMinutes("18:00")).toBe(1080);
    expect(minutesToHhmm(510)).toBe("08:30");
    expect(minutesToHhmm(1080)).toBe("18:00");
  });

  it("rejette une heure invalide", () => {
    expect(() => hhmmToMinutes("25:00")).toThrow();
    expect(() => hhmmToMinutes("aa:bb")).toThrow();
  });

  it("valide la cohérence d'un horaire", () => {
    expect(() => assertScheduleCoherent({ dayStartMin: 510, lunchStartMin: 720, lunchEndMin: 780, dayEndMin: 1080 })).not.toThrow();
    expect(() => assertScheduleCoherent({ dayStartMin: 510, lunchStartMin: 780, lunchEndMin: 720, dayEndMin: 1080 })).toThrow();
  });
});
