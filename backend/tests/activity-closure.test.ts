import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import { activityClosureStatus, sweepClosureReminders } from "../src/lib/activityClosure.js";
import { resolveSchedule } from "../src/lib/attendance.js";

// Signalement de clôture d'activité mensuelle. Règle testée : la clôture tombe
// le DERNIER JOUR OUVRABLE du mois (horaire de la maison + jours fériés), les
// rappels sont émis 1 et 2 jours avant, l'idempotence est garantie, aucun
// rappel si la période est déjà clôturée, et les permissions des endpoints.

const rnd = Math.floor(Math.random() * 1e6);
const PWD = "ClosurePass123!";
const YEAR = 2031; // année lointaine, isolée des données réelles

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// Réimplémentation indépendante du « dernier jour ouvrable » pour vérifier le
// code de production (mêmes sources : horaire résolu + jours fériés).
async function expectedLastWorkingDay(year: number, monthIndex: number): Promise<Date> {
  const sched = await resolveSchedule({ onDate: new Date(year, monthIndex, 1) });
  const wd = sched.workingDays;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const holidays = await prisma.publicHoliday.findMany({
    where: {
      day: {
        gte: new Date(`${year}-${pad2(monthIndex + 1)}-01T00:00:00.000Z`),
        lte: new Date(`${year}-${pad2(monthIndex + 1)}-${pad2(daysInMonth)}T00:00:00.000Z`),
      },
    },
    select: { day: true },
  });
  const hset = new Set(holidays.map((h) => h.day.toISOString().slice(0, 10)));
  for (let d = daysInMonth; d >= 1; d--) {
    const dt = new Date(year, monthIndex, d);
    const iso = ((dt.getDay() + 6) % 7) + 1;
    if (wd.includes(iso) && !hset.has(`${year}-${pad2(monthIndex + 1)}-${pad2(d)}`)) return dt;
  }
  return new Date(year, monthIndex, daysInMonth);
}

async function login(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

async function cleanupPeriod(periodKey: string) {
  await prisma.payrollClosureReminder.deleteMany({ where: { periodKey } });
  await prisma.payrollClosure.deleteMany({ where: { periodKey } });
  await prisma.notification.deleteMany({ where: { entityType: "payroll_closure", entityId: periodKey } });
}

describe("RH — signalement de clôture d'activité", () => {
  let app: FastifyInstance;
  let rhUserId: string;
  let rhCookie: string;
  let readerCookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const rh = await createUserWithRole(`clos_rh_${rnd}`, "RESP_RH", PWD);
    rhUserId = rh.id;
    await createUserWithRole(`clos_reader_${rnd}`, "CORRECTEUR", PWD);
    rhCookie = await login(app, `clos_rh_${rnd}`, PWD);
    readerCookie = await login(app, `clos_reader_${rnd}`, PWD);
  });

  afterAll(async () => {
    await app.close();
  });

  it("l'échéance est le dernier jour ouvrable du mois, la période = ce mois", async () => {
    const lwd = await expectedLastWorkingDay(YEAR, 6); // juillet
    const now = new Date(YEAR, 6, 3); // 3 juillet, avant l'échéance
    const status = await activityClosureStatus(now);

    expect(status.closure_day).toBe(lwd.getDate());
    expect(status.period_key).toBe(`${YEAR}-07`); // le dernier jour ouvrable de juillet clôture juillet
    expect(status.reminder_days).toEqual([addDays(lwd, -2).getDate(), addDays(lwd, -1).getDate()]);
    expect(new Date(status.closure_date).getDate()).toBe(lwd.getDate());
  });

  it("envoie le rappel 1 et 2 jours avant l'échéance, pas le jour même", async () => {
    const lwd = await expectedLastWorkingDay(YEAR, 6); // juillet
    const periodKey = `${YEAR}-07`;
    await cleanupPeriod(periodKey);

    // Le jour de clôture lui-même : hors fenêtre de rappel.
    expect((await sweepClosureReminders(lwd)).reason).toBe("hors_fenetre");

    // Deux jours avant : envoi.
    const r1 = await sweepClosureReminders(addDays(lwd, -2));
    expect(r1.sent).toBe(true);
    expect(r1.periodKey).toBe(periodKey);

    const notif = await prisma.notification.findFirst({
      where: { userId: rhUserId, entityType: "payroll_closure", entityId: periodKey },
    });
    expect(notif).not.toBeNull();
    expect(notif?.type).toBe("echeance");

    // Rejoué le même jour : idempotent.
    const r2 = await sweepClosureReminders(addDays(lwd, -2));
    expect(r2.sent).toBe(false);
    expect(r2.reason).toBe("deja_envoye");
    const count = await prisma.notification.count({
      where: { userId: rhUserId, entityType: "payroll_closure", entityId: periodKey },
    });
    expect(count).toBe(1);

    // La veille : deuxième rappel autorisé.
    const r3 = await sweepClosureReminders(addDays(lwd, -1));
    expect(r3.sent).toBe(true);

    await cleanupPeriod(periodKey);
  });

  it("n'envoie aucun rappel si la période est déjà clôturée", async () => {
    const lwd = await expectedLastWorkingDay(YEAR, 7); // août
    const periodKey = `${YEAR}-08`;
    await cleanupPeriod(periodKey);
    await prisma.payrollClosure.create({
      data: { periodKey, employees: 1, rateEffectiveFrom: new Date(`${YEAR}-08-01`) },
    });
    const r = await sweepClosureReminders(addDays(lwd, -2));
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("deja_cloturee");
    await cleanupPeriod(periodKey);
  });

  it("permissions : lecture réservée au RH", async () => {
    const denied = await app.inject({ method: "GET", url: "/api/v1/hr/activity-closure", headers: { cookie: readerCookie } });
    expect(denied.statusCode).toBe(403);

    const ok = await app.inject({ method: "GET", url: "/api/v1/hr/activity-closure", headers: { cookie: rhCookie } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toHaveProperty("closure_day");
  });

  it("l'ancien réglage du jour de clôture n'existe plus (404)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/hr/activity-closure/day",
      headers: { cookie: rhCookie },
      payload: { closure_day: 8 },
    });
    expect(res.statusCode).toBe(404);
  });
});
