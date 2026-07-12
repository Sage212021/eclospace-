import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requirePermission, requireAuth } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import {
  assertScheduleCoherent,
  hhmmToMinutes,
  minutesToHhmm,
  resolveSchedule,
} from "../lib/attendance.js";
import { computeDay, summarize, type DayEvent, type DayResult } from "../lib/attendanceCompute.js";

// Module « Présences & Temps de travail » — incrément 1 : paramétrage des
// horaires officiels, jours fériés, et consultation du pointage brut.
// Permissions : module `presences` (consultation / saisie / validation /
// administration). Distinct de /api/v1/presence/names (présence temps réel du
// Hall) — ici il s'agit du pointage historisé.

const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/, "Heure attendue au format HH:MM.");
const workingDays = z
  .string()
  .regex(/^([1-7])(,[1-7])*$/, "Jours ouvrables : chiffres 1-7 séparés par des virgules.");

const scheduleSchema = z.object({
  scope: z.enum(["company", "department", "employee"]).default("company"),
  department_id: z.string().uuid().optional(),
  employee_id: z.string().uuid().optional(),
  day_start: hhmm,
  lunch_start: hhmm,
  lunch_end: hhmm,
  day_end: hhmm,
  working_days: workingDays.default("1,2,3,4,5"),
  effective_from: z.string().datetime().optional(),
  label: z.string().max(120).optional(),
});

const schedulePatchSchema = z.object({
  day_start: hhmm.optional(),
  lunch_start: hhmm.optional(),
  lunch_end: hhmm.optional(),
  day_end: hhmm.optional(),
  working_days: workingDays.optional(),
  active: z.boolean().optional(),
  label: z.string().max(120).optional(),
});

const holidaySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ."),
  label: z.string().min(1).max(120),
});

function scheduleView(s: {
  id: string;
  scope: string;
  departmentId: string | null;
  employeeId: string | null;
  dayStartMin: number;
  lunchStartMin: number;
  lunchEndMin: number;
  dayEndMin: number;
  workingDays: string;
  effectiveFrom: Date;
  active: boolean;
  label: string | null;
}) {
  return {
    id: s.id,
    scope: s.scope,
    department_id: s.departmentId,
    employee_id: s.employeeId,
    day_start: minutesToHhmm(s.dayStartMin),
    lunch_start: minutesToHhmm(s.lunchStartMin),
    lunch_end: minutesToHhmm(s.lunchEndMin),
    day_end: minutesToHhmm(s.dayEndMin),
    working_days: s.workingDays,
    effective_from: s.effectiveFrom,
    active: s.active,
    label: s.label,
  };
}

// Un employé ne voit par défaut que SES propres données. Un profil habilité
// (RH via presences:validation/administration, chef de département, direction)
// peut consulter celles des autres.
function canSeeOthers(user: { permissions: Set<string>; roles: string[] }): boolean {
  return (
    user.permissions.has("presences:validation") ||
    user.permissions.has("presences:administration") ||
    user.permissions.has("direction:consultation") ||
    user.roles.includes("CHEF_DEPARTEMENT")
  );
}

async function ownEmployeeId(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true } });
  return u?.employeeId ?? null;
}

export default async function attendanceRoutes(fastify: FastifyInstance) {
  // Horaire officiel applicable (résolu) — pour un employé donné ou la maison.
  fastify.get(
    "/api/v1/attendance/work-schedule",
    { preHandler: requirePermission("presences", "consultation") },
    async (request, reply) => {
      const query = request.query as { employee_id?: string };
      let employeeId = query.employee_id ?? null;
      // Périmètre : sans droit élargi, on force la résolution sur soi-même.
      if (employeeId && employeeId !== (await ownEmployeeId(request.user!.id)) && !canSeeOthers(request.user!)) {
        return reply.code(403).send({ code: "forbidden", message: "Consultation limitée à vos propres horaires." });
      }
      let departmentId: string | null = null;
      if (employeeId) {
        const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { departmentId: true } });
        departmentId = emp?.departmentId ?? null;
      } else {
        employeeId = await ownEmployeeId(request.user!.id);
        if (employeeId) {
          const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { departmentId: true } });
          departmentId = emp?.departmentId ?? null;
        }
      }
      const resolved = await resolveSchedule({ employeeId, departmentId });
      return reply.send({
        day_start: minutesToHhmm(resolved.dayStartMin),
        lunch_start: minutesToHhmm(resolved.lunchStartMin),
        lunch_end: minutesToHhmm(resolved.lunchEndMin),
        day_end: minutesToHhmm(resolved.dayEndMin),
        working_days: resolved.workingDays.join(","),
        source: resolved.source,
      });
    },
  );

  // Liste des horaires paramétrés (maison + surcharges).
  fastify.get(
    "/api/v1/attendance/work-schedules",
    { preHandler: requirePermission("presences", "consultation") },
    async (_request, reply) => {
      const rows = await prisma.workSchedule.findMany({
        where: { deletedAt: null },
        orderBy: [{ scope: "asc" }, { effectiveFrom: "desc" }],
      });
      return reply.send(rows.map(scheduleView));
    },
  );

  // Création d'un horaire (maison ou surcharge département/employé).
  fastify.post(
    "/api/v1/attendance/work-schedules",
    { preHandler: requirePermission("presences", "administration") },
    async (request, reply) => {
      const parsed = scheduleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const b = parsed.data;
      const times = {
        dayStartMin: hhmmToMinutes(b.day_start),
        lunchStartMin: hhmmToMinutes(b.lunch_start),
        lunchEndMin: hhmmToMinutes(b.lunch_end),
        dayEndMin: hhmmToMinutes(b.day_end),
      };
      try {
        assertScheduleCoherent(times);
      } catch (err) {
        return reply.code(400).send({ code: "incoherent_schedule", message: (err as Error).message });
      }
      if (b.scope === "department" && !b.department_id) {
        return reply.code(400).send({ code: "validation_error", message: "Un horaire de département requiert department_id." });
      }
      if (b.scope === "employee" && !b.employee_id) {
        return reply.code(400).send({ code: "validation_error", message: "Un horaire d'employé requiert employee_id." });
      }
      const created = await prisma.workSchedule.create({
        data: {
          scope: b.scope,
          departmentId: b.scope === "department" ? b.department_id : null,
          employeeId: b.scope === "employee" ? b.employee_id : null,
          ...times,
          workingDays: b.working_days,
          effectiveFrom: b.effective_from ? new Date(b.effective_from) : new Date(),
          label: b.label,
          createdBy: request.user!.id,
        },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "work_schedule",
        entityId: created.id,
        newValues: scheduleView(created),
        ipAddress: request.ip,
      });
      return reply.code(201).send(scheduleView(created));
    },
  );

  // Modification d'un horaire — journalisée (ancienne → nouvelle valeur).
  fastify.patch(
    "/api/v1/attendance/work-schedules/:id",
    { preHandler: requirePermission("presences", "administration") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = schedulePatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const existing = await prisma.workSchedule.findFirst({ where: { id, deletedAt: null } });
      if (!existing) return reply.code(404).send({ code: "not_found", message: "Horaire introuvable." });
      const b = parsed.data;
      const next = {
        dayStartMin: b.day_start ? hhmmToMinutes(b.day_start) : existing.dayStartMin,
        lunchStartMin: b.lunch_start ? hhmmToMinutes(b.lunch_start) : existing.lunchStartMin,
        lunchEndMin: b.lunch_end ? hhmmToMinutes(b.lunch_end) : existing.lunchEndMin,
        dayEndMin: b.day_end ? hhmmToMinutes(b.day_end) : existing.dayEndMin,
      };
      try {
        assertScheduleCoherent(next);
      } catch (err) {
        return reply.code(400).send({ code: "incoherent_schedule", message: (err as Error).message });
      }
      const updated = await prisma.workSchedule.update({
        where: { id },
        data: {
          ...next,
          workingDays: b.working_days ?? existing.workingDays,
          active: b.active ?? existing.active,
          label: b.label ?? existing.label,
          updatedBy: request.user!.id,
        },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "work_schedule",
        entityId: id,
        oldValues: scheduleView(existing),
        newValues: scheduleView(updated),
        ipAddress: request.ip,
      });
      return reply.send(scheduleView(updated));
    },
  );

  // Jours fériés / chômés.
  fastify.get(
    "/api/v1/attendance/holidays",
    { preHandler: requirePermission("presences", "consultation") },
    async (_request, reply) => {
      const rows = await prisma.publicHoliday.findMany({ orderBy: { day: "asc" } });
      return reply.send(rows.map((h) => ({ id: h.id, day: h.day.toISOString().slice(0, 10), label: h.label })));
    },
  );

  fastify.post(
    "/api/v1/attendance/holidays",
    { preHandler: requirePermission("presences", "administration") },
    async (request, reply) => {
      const parsed = holidaySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const day = new Date(`${parsed.data.day}T00:00:00.000Z`);
      const existing = await prisma.publicHoliday.findUnique({ where: { day } });
      if (existing) {
        return reply.code(409).send({ code: "holiday_exists", message: "Ce jour férié est déjà enregistré." });
      }
      const created = await prisma.publicHoliday.create({
        data: { day, label: parsed.data.label, createdBy: request.user!.id },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "public_holiday",
        entityId: created.id,
        newValues: { day: parsed.data.day, label: created.label },
        ipAddress: request.ip,
      });
      return reply.code(201).send({ id: created.id, day: parsed.data.day, label: created.label });
    },
  );

  // Pointage brut (connexions/déconnexions) — self par défaut, élargi si habilité.
  fastify.get(
    "/api/v1/attendance/events",
    { preHandler: requirePermission("presences", "consultation") },
    async (request: FastifyRequest, reply) => {
      const query = request.query as { employee_id?: string; from?: string; to?: string };
      const own = await ownEmployeeId(request.user!.id);
      let employeeId = query.employee_id ?? own;
      if (query.employee_id && query.employee_id !== own && !canSeeOthers(request.user!)) {
        return reply.code(403).send({ code: "forbidden", message: "Consultation limitée à votre propre pointage." });
      }
      const where: Record<string, unknown> = {};
      // Sans fiche employé rattachée, on retombe sur l'identifiant utilisateur.
      if (employeeId) where.employeeId = employeeId;
      else where.userId = request.user!.id;
      const occurredAt: Record<string, Date> = {};
      if (query.from) occurredAt.gte = new Date(query.from);
      if (query.to) occurredAt.lte = new Date(query.to);
      if (Object.keys(occurredAt).length) where.occurredAt = occurredAt;
      const rows = await prisma.attendanceEvent.findMany({
        where,
        orderBy: { occurredAt: "desc" },
        take: 500,
      });
      return reply.send(
        rows.map((e) => ({
          id: e.id,
          kind: e.kind,
          source: e.source,
          occurred_at: e.occurredAt,
          ip_address: e.ipAddress,
          device: e.device,
        })),
      );
    },
  );

  // Calcul de la journée d'un employé (présence, retard, départ anticipé,
  // heures sup) — §12-17. Périmètre self par défaut.
  fastify.get(
    "/api/v1/attendance/daily",
    { preHandler: requirePermission("presences", "consultation") },
    async (request, reply) => {
      const query = request.query as { employee_id?: string; date?: string };
      const date = query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : todayKey();
      const target = await resolveTargetEmployee(request, query.employee_id);
      if ("forbidden" in target) return reply.code(403).send(target.forbidden);
      // Sans fiche employé rattachée, aucun calcul de présence n'a de sens.
      if (!target.employeeId) return reply.send(null);
      const summary = await computeRange(target.employeeId, target.departmentId, date, date);
      return reply.send(summary.days[0] ?? null);
    },
  );

  // Synthèse sur une période (jour/semaine/mois…) — §20, base du rapport RH.
  fastify.get(
    "/api/v1/attendance/summary",
    { preHandler: requirePermission("presences", "consultation") },
    async (request, reply) => {
      const query = request.query as { employee_id?: string; from?: string; to?: string };
      const { from, to } = monthDefault(query.from, query.to);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
        return reply.code(400).send({ code: "validation_error", message: "Période invalide (from/to au format AAAA-MM-JJ, from ≤ to)." });
      }
      const target = await resolveTargetEmployee(request, query.employee_id);
      if ("forbidden" in target) return reply.code(403).send(target.forbidden);
      // Sans fiche employé rattachée (ex. super-administrateur), on n'invente
      // pas d'absences : synthèse neutre avec le drapeau no_employee.
      if (!target.employeeId) {
        return reply.send({
          from,
          to,
          days: [],
          no_employee: true,
          totals: {
            worked_minutes: 0,
            expected_minutes: 0,
            late_minutes: 0,
            early_leave_minutes: 0,
            overtime_minutes: 0,
            interruption_minutes: 0,
            days_worked: 0,
            days_absent_unjustified: 0,
            days_absent_justified: 0,
          },
        });
      }
      const summary = await computeRange(target.employeeId, target.departmentId, from, to);
      return reply.send(summary);
    },
  );

  // Petit point d'entrée de santé du module (utile aux futurs tableaux de bord).
  fastify.get("/api/v1/attendance/ping", { preHandler: requireAuth }, async (_request, reply) => {
    return reply.send({ module: "presences", ok: true });
  });
}

// ----- Helpers de calcul (incrément 2) --------------------------------------

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// Par défaut : le mois calendaire courant.
function monthDefault(from?: string, to?: string): { from: string; to: string } {
  if (from && to) return { from, to };
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const first = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return { from: from ?? first, to: to ?? last };
}

// Décalage horaire métier (Cameroun = UTC+1, WAT, sans heure d'été).
// Paramétrable via le réglage presence_timezone_offset_minutes.
async function businessOffsetMinutes(): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: "presence_timezone_offset_minutes" } });
  const raw = s?.value;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 60;
}

function toLocal(d: Date, offsetMin: number): { dayKey: string; minutes: number } {
  const shifted = new Date(d.getTime() + offsetMin * 60000);
  return { dayKey: shifted.toISOString().slice(0, 10), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

function isoWeekday(dayKey: string): number {
  const day = new Date(`${dayKey}T00:00:00.000Z`).getUTCDay(); // 0=dim … 6=sam
  return ((day + 6) % 7) + 1; // 1=lun … 7=dim
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// Résout l'employé cible et vérifie le périmètre (self sauf profil habilité).
async function resolveTargetEmployee(
  request: FastifyRequest,
  requestedId?: string,
): Promise<{ employeeId: string | null; departmentId: string | null } | { forbidden: { code: string; message: string } }> {
  const own = await prisma.user.findUnique({ where: { id: request.user!.id }, select: { employeeId: true } });
  const ownEmp = own?.employeeId ?? null;
  if (requestedId && requestedId !== ownEmp && !canSeeOthers(request.user!)) {
    return { forbidden: { code: "forbidden", message: "Consultation limitée à vos propres présences." } };
  }
  const employeeId = requestedId ?? ownEmp;
  let departmentId: string | null = null;
  if (employeeId) {
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { departmentId: true } });
    departmentId = emp?.departmentId ?? null;
  }
  return { employeeId, departmentId };
}

async function computeRange(employeeId: string | null, departmentId: string | null, from: string, to: string) {
  const offset = await businessOffsetMinutes();
  const schedule = await resolveSchedule({ employeeId, departmentId, onDate: new Date(`${to}T00:00:00.000Z`) });

  // Fenêtre UTC élargie d'un jour de chaque côté pour capter les événements
  // dont le jour local déborde la frontière UTC.
  const fromUtc = new Date(`${from}T00:00:00.000Z`);
  fromUtc.setUTCDate(fromUtc.getUTCDate() - 1);
  const toUtc = new Date(`${to}T00:00:00.000Z`);
  toUtc.setUTCDate(toUtc.getUTCDate() + 2);

  const [events, holidays] = await Promise.all([
    employeeId
      ? prisma.attendanceEvent.findMany({
          where: { employeeId, occurredAt: { gte: fromUtc, lte: toUtc } },
          select: { kind: true, occurredAt: true },
        })
      : Promise.resolve([]),
    prisma.publicHoliday.findMany({
      where: { day: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) } },
      select: { day: true },
    }),
  ]);

  // Absences validées couvrant la période (nature de justification par jour).
  const absences = employeeId
    ? await prisma.absence.findMany({
        where: {
          employeeId,
          status: "validee",
          fromDate: { lte: new Date(`${to}T23:59:59.000Z`) },
          toDate: { gte: new Date(`${from}T00:00:00.000Z`) },
        },
        select: { type: true, fromDate: true, toDate: true },
      })
    : [];

  const holidaySet = new Set(holidays.map((h) => h.day.toISOString().slice(0, 10)));
  const eventsByDay = new Map<string, DayEvent[]>();
  for (const e of events) {
    const { dayKey, minutes } = toLocal(e.occurredAt, offset);
    if (!eventsByDay.has(dayKey)) eventsByDay.set(dayKey, []);
    eventsByDay.get(dayKey)!.push({ kind: e.kind, localMinutes: minutes });
  }

  function coveringFor(dayKey: string): { type: string } | null {
    const dayStart = new Date(`${dayKey}T00:00:00.000Z`);
    const dayEnd = new Date(`${dayKey}T23:59:59.000Z`);
    const a = absences.find((x) => x.fromDate <= dayEnd && x.toDate >= dayStart);
    return a ? { type: a.type } : null;
  }

  const days: DayResult[] = eachDay(from, to).map((dayKey) =>
    computeDay({
      date: dayKey,
      isoWeekday: isoWeekday(dayKey),
      events: eventsByDay.get(dayKey) ?? [],
      schedule: {
        dayStartMin: schedule.dayStartMin,
        lunchStartMin: schedule.lunchStartMin,
        lunchEndMin: schedule.lunchEndMin,
        dayEndMin: schedule.dayEndMin,
        workingDays: schedule.workingDays,
      },
      isHoliday: holidaySet.has(dayKey),
      covering: coveringFor(dayKey),
    }),
  );

  return summarize(from, to, days);
}
