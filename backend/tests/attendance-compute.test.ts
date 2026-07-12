import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import { buildIntervals, computeDay, type DaySchedule } from "../src/lib/attendanceCompute.js";

// Calculs de présence (incrément 2) — règles critiques : tests obligatoires
// (CLAUDE.md règle 4). Horaire de référence : 08:30-18:00, pause 12h-13h.

const S: DaySchedule = {
  dayStartMin: 8 * 60 + 30, // 510
  lunchStartMin: 12 * 60, // 720
  lunchEndMin: 13 * 60, // 780
  dayEndMin: 18 * 60, // 1080
  workingDays: [1, 2, 3, 4, 5],
};

// 2026-03-10 est un mardi (jour ouvrable) ; 2026-03-14 un samedi.
const TUESDAY = "2026-03-10";
const SATURDAY = "2026-03-14";

function day(events: { kind: string; localMinutes: number }[], opts?: { date?: string; isHoliday?: boolean; covering?: { type: string } | null }) {
  return computeDay({
    date: opts?.date ?? TUESDAY,
    isoWeekday: 2,
    events,
    schedule: S,
    isHoliday: opts?.isHoliday ?? false,
    covering: opts?.covering ?? null,
  });
}

describe("computeDay — règles de calcul", () => {
  it("journée pleine 08:30-18:00 : temps travaillé = 8h30 (pause exclue), sans retard ni heures sup", () => {
    const r = day([
      { kind: "in", localMinutes: 510 },
      { kind: "out", localMinutes: 1080 },
    ]);
    expect(r.worked_minutes).toBe(510); // 570 de présence − 60 de pause
    expect(r.expected_minutes).toBe(510);
    expect(r.late_minutes).toBe(0);
    expect(r.early_leave_minutes).toBe(0);
    expect(r.overtime_minutes).toBe(0);
    expect(r.interruption_minutes).toBe(0);
    expect(r.absent_full_day).toBe(false);
  });

  it("retard : arrivée à 09:00 → 30 minutes de retard", () => {
    const r = day([
      { kind: "in", localMinutes: 540 },
      { kind: "out", localMinutes: 1080 },
    ]);
    expect(r.late_minutes).toBe(30);
    expect(r.worked_minutes).toBe(480);
  });

  it("départ anticipé : départ à 17:00 → 60 minutes", () => {
    const r = day([
      { kind: "in", localMinutes: 510 },
      { kind: "out", localMinutes: 1020 },
    ]);
    expect(r.early_leave_minutes).toBe(60);
    expect(r.overtime_minutes).toBe(0);
  });

  it("heures supplémentaires : départ à 19:00 → 60 minutes", () => {
    const r = day([
      { kind: "in", localMinutes: 510 },
      { kind: "out", localMinutes: 1140 },
    ]);
    expect(r.overtime_minutes).toBe(60);
    expect(r.worked_minutes).toBe(510); // le temps sup n'augmente pas le temps « dans la plage »
  });

  it("pause déjeuner exclue (§16) : sortie 11:45 → retour 13:15 = 30 min d'absence, pause non comptée", () => {
    const r = day([
      { kind: "in", localMinutes: 510 }, // 08:30
      { kind: "out", localMinutes: 705 }, // 11:45
      { kind: "in", localMinutes: 795 }, // 13:15
      { kind: "out", localMinutes: 1080 }, // 18:00
    ]);
    // 11:45→12:00 (15) + 13:00→13:15 (15) = 30 min manquants, la pause 12h-13h ne compte pas.
    expect(r.worked_minutes).toBe(480);
    expect(r.interruption_minutes).toBe(30);
    expect(r.late_minutes).toBe(0);
    expect(r.early_leave_minutes).toBe(0);
  });

  it("absence pleine journée : jour ouvrable sans pointage", () => {
    const r = day([]);
    expect(r.absent_full_day).toBe(true);
    expect(r.worked_minutes).toBe(0);
    expect(r.justified).toBe(false);
  });

  it("absence justifiée : un congé validé couvre le jour", () => {
    const r = day([], { covering: { type: "conge" } });
    expect(r.absent_full_day).toBe(true);
    expect(r.justified).toBe(true);
    expect(r.nature).toBe("conge");
  });

  it("jour férié : pas de temps attendu, pas d'absence", () => {
    const r = day([], { isHoliday: true });
    expect(r.is_working_day).toBe(false);
    expect(r.expected_minutes).toBe(0);
    expect(r.absent_full_day).toBe(false);
  });

  it("week-end : samedi hors jours ouvrables", () => {
    const r = computeDay({ date: SATURDAY, isoWeekday: 6, events: [], schedule: S, isHoliday: false, covering: null });
    expect(r.is_working_day).toBe(false);
    expect(r.absent_full_day).toBe(false);
  });
});

describe("buildIntervals — reconstitution de la journée", () => {
  it("ferme un « in » sans « out » à la fin de journée officielle", () => {
    const intervals = buildIntervals([{ kind: "in", localMinutes: 510 }], S.dayEndMin);
    expect(intervals).toEqual([[510, 1080]]);
  });

  it("ignore un « out » orphelin et les « in » en double", () => {
    const intervals = buildIntervals(
      [
        { kind: "out", localMinutes: 400 },
        { kind: "in", localMinutes: 510 },
        { kind: "in", localMinutes: 520 },
        { kind: "out", localMinutes: 1080 },
      ],
      S.dayEndMin,
    );
    expect(intervals).toEqual([[510, 1080]]);
  });
});

describe("intégration /api/v1/attendance/daily + /summary", () => {
  let app: FastifyInstance;
  let cookie: string;
  let employeeId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));

    const emp = await prisma.employee.create({ data: { firstName: "Calc", lastName: "Test" } });
    employeeId = emp.id;
    // Décalage métier UTC+1 : pour une arrivée locale 09:00, on stocke 08:00 UTC.
    await prisma.attendanceEvent.createMany({
      data: [
        { userId: admin.id, employeeId, kind: "in", occurredAt: new Date(`${TUESDAY}T08:00:00.000Z`) },
        { userId: admin.id, employeeId, kind: "out", occurredAt: new Date(`${TUESDAY}T16:00:00.000Z`) },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("calcule la journée d'un employé (retard 30, départ anticipé 60)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/attendance/daily?employee_id=${employeeId}&date=${TUESDAY}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    // Arrivée locale 09:00 → retard 30 ; départ local 17:00 → départ anticipé 60.
    expect(d.late_minutes).toBe(30);
    expect(d.early_leave_minutes).toBe(60);
    expect(d.worked_minutes).toBe(420);
  });

  it("agrège une période (totaux)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/attendance/summary?employee_id=${employeeId}&from=${TUESDAY}&to=${TUESDAY}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s.days).toHaveLength(1);
    expect(s.totals.worked_minutes).toBe(420);
    expect(s.totals.late_minutes).toBe(30);
    expect(s.totals.days_worked).toBe(1);
  });

  it("refuse une période invalide (400)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/attendance/summary?employee_id=${employeeId}&from=2026-03-31&to=2026-03-01`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});
