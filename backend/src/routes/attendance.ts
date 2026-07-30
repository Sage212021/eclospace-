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
  DEFAULT_SCHEDULE,
} from "../lib/attendance.js";
import { computeDay, summarize, type DayEvent, type DayResult } from "../lib/attendanceCompute.js";
import { computeDeduction, type DeductionRuleView } from "../lib/attendanceDeduction.js";
import { canTransition, detectAnomalies, nextStatus, DEFAULT_THRESHOLDS, type AnomalyAction } from "../lib/attendanceAnomaly.js";
import { poleForPresence } from "../lib/presence.js";

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

  // ----- Règles de retenues (§21-22) -----------------------------------------

  fastify.get(
    "/api/v1/attendance/deduction-rules",
    { preHandler: requirePermission("presences", "consultation") },
    async (_request, reply) => {
      const rows = await prisma.deductionRule.findMany({ orderBy: { effectiveFrom: "desc" } });
      return reply.send(rows.map(deductionRuleView));
    },
  );

  // Nouvelle version de la règle (les anciennes sont conservées, §21).
  fastify.post(
    "/api/v1/attendance/deduction-rules",
    { preHandler: requirePermission("presences", "administration") },
    async (request, reply) => {
      const parsed = deductionRuleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const b = parsed.data;
      const created = await prisma.deductionRule.create({
        data: {
          perMinute: b.per_minute ?? null,
          perHalfHour: b.per_half_hour,
          perHour: b.per_hour,
          dailyCap: b.daily_cap ?? null,
          monthlyCap: b.monthly_cap ?? null,
          method: b.method,
          effectiveFrom: b.effective_from ? new Date(b.effective_from) : new Date(),
          label: b.label,
          createdBy: request.user!.id,
        },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "deduction_rule",
        entityId: created.id,
        newValues: deductionRuleView(created),
        ipAddress: request.ip,
      });
      return reply.code(201).send(deductionRuleView(created));
    },
  );

  fastify.patch(
    "/api/v1/attendance/deduction-rules/:id",
    { preHandler: requirePermission("presences", "administration") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ active: z.boolean().optional(), label: z.string().max(120).optional() }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const existing = await prisma.deductionRule.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ code: "not_found", message: "Règle introuvable." });
      const updated = await prisma.deductionRule.update({
        where: { id },
        data: { active: parsed.data.active ?? existing.active, label: parsed.data.label ?? existing.label, updatedBy: request.user!.id },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "deduction_rule",
        entityId: id,
        oldValues: deductionRuleView(existing),
        newValues: deductionRuleView(updated),
        ipAddress: request.ip,
      });
      return reply.send(deductionRuleView(updated));
    },
  );

  // Aperçu de la retenue proposée pour un employé sur une période, selon la
  // règle en vigueur — respecte les justifications et les plafonds.
  fastify.get(
    "/api/v1/attendance/deduction-preview",
    { preHandler: requirePermission("presences", "consultation") },
    async (request, reply) => {
      const query = request.query as { employee_id?: string; from?: string; to?: string };
      const { from, to } = monthDefault(query.from, query.to);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
        return reply.code(400).send({ code: "validation_error", message: "Période invalide." });
      }
      const target = await resolveTargetEmployee(request, query.employee_id);
      if ("forbidden" in target) return reply.code(403).send(target.forbidden);
      const rule = await resolveDeductionRule(new Date(`${to}T00:00:00.000Z`));
      if (!rule) {
        return reply.send({ from, to, rule: null, message: "Aucune règle de retenue en vigueur.", by_day: [], total_deduction: 0, total_retainable_minutes: 0 });
      }
      if (!target.employeeId) {
        return reply.send({ from, to, rule, no_employee: true, by_day: [], total_deduction: 0, total_retainable_minutes: 0, total_before_monthly_cap: 0 });
      }
      const summary = await computeRange(target.employeeId, target.departmentId, from, to);
      const result = computeDeduction(summary.days, rule, await deductAbsencesEnabled());
      return reply.send({ from, to, rule, ...result });
    },
  );

  // ----- Anomalies & workflow de validation (§19, §23-26) --------------------

  // Scan d'une période : crée les anomalies manquantes (idempotent). Réservé aux
  // profils habilités (validation) et borné à leur périmètre.
  fastify.post(
    "/api/v1/attendance/anomalies/scan",
    { preHandler: requirePermission("presences", "validation") },
    async (request, reply) => {
      const query = request.query as { employee_id?: string; from?: string; to?: string };
      if (!query.employee_id) {
        return reply.code(400).send({ code: "validation_error", message: "employee_id requis pour le scan." });
      }
      if (!(await canActOnEmployee(request.user!, query.employee_id))) {
        return reply.code(403).send({ code: "forbidden", message: "Hors de votre périmètre de validation." });
      }
      const { from, to } = monthDefault(query.from, query.to);
      const emp = await prisma.employee.findUnique({ where: { id: query.employee_id }, select: { departmentId: true } });
      const summary = await computeRange(query.employee_id, emp?.departmentId ?? null, from, to);
      const thresholds = await anomalyThresholds();
      const detected = detectAnomalies(summary.days, thresholds);
      let created = 0;
      for (const a of detected) {
        const day = new Date(`${a.day}T00:00:00.000Z`);
        const exists = await prisma.attendanceAnomaly.findUnique({
          where: { employeeId_day_type: { employeeId: query.employee_id, day, type: a.type } },
        });
        if (!exists) {
          await prisma.attendanceAnomaly.create({
            data: { employeeId: query.employee_id, day, type: a.type, minutes: a.minutes, detail: a.detail, createdBy: request.user!.id },
          });
          created += 1;
        }
      }
      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "attendance_anomaly_scan",
        entityId: query.employee_id,
        newValues: { from, to, detected: detected.length, created },
        ipAddress: request.ip,
      });
      return reply.send({ from, to, detected: detected.length, created });
    },
  );

  // File des anomalies — confidentialité : employé (les siennes), chef (son
  // pôle), RH/DG (toutes).
  fastify.get(
    "/api/v1/attendance/anomalies",
    { preHandler: requirePermission("presences", "consultation") },
    async (request, reply) => {
      const query = request.query as { status?: string; employee_id?: string; from?: string; to?: string };
      const where: Record<string, unknown> = {};
      if (query.status) where.status = query.status;
      if (query.from || query.to) {
        const day: Record<string, Date> = {};
        if (query.from) day.gte = new Date(`${query.from}T00:00:00.000Z`);
        if (query.to) day.lte = new Date(`${query.to}T00:00:00.000Z`);
        where.day = day;
      }

      const scope = await anomalyScope(request.user!);
      if (scope.kind === "self") {
        if (!scope.employeeId) return reply.send([]);
        where.employeeId = scope.employeeId;
      } else if (scope.kind === "pole") {
        where.employeeId = { in: scope.employeeIds };
      } // kind === "all" : aucun filtre d'employé.
      if (query.employee_id) {
        // Un filtre explicite doit rester dans le périmètre autorisé.
        if (scope.kind === "self" && query.employee_id !== scope.employeeId) return reply.code(403).send({ code: "forbidden", message: "Hors périmètre." });
        if (scope.kind === "pole" && !scope.employeeIds.includes(query.employee_id)) return reply.code(403).send({ code: "forbidden", message: "Hors périmètre." });
        where.employeeId = query.employee_id;
      }

      const rows = await prisma.attendanceAnomaly.findMany({
        where,
        orderBy: [{ day: "desc" }, { createdAt: "desc" }],
        take: 500,
        include: { employee: { select: { firstName: true, lastName: true } } },
      });
      return reply.send(rows.map(anomalyView));
    },
  );

  // Justification d'une anomalie (§24) — motif + commentaire (+ pièce jointe).
  // Autorisé : l'employé concerné, son chef de pôle, RH/DG.
  fastify.post(
    "/api/v1/attendance/anomalies/:id/justify",
    { preHandler: requirePermission("presences", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z
        .object({ motif: z.string().min(1).max(120), comment: z.string().max(2000).optional(), document_id: z.string().uuid().optional() })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const anomaly = await prisma.attendanceAnomaly.findUnique({ where: { id } });
      if (!anomaly) return reply.code(404).send({ code: "not_found", message: "Anomalie introuvable." });
      const ownEmp = await ownEmployeeId(request.user!.id);
      const isOwner = ownEmp && anomaly.employeeId === ownEmp;
      if (!isOwner && !(await canActOnEmployee(request.user!, anomaly.employeeId))) {
        return reply.code(403).send({ code: "forbidden", message: "Vous ne pouvez pas justifier cette anomalie." });
      }
      if (anomaly.status === "validee" || anomaly.status === "annulee") {
        return reply.code(409).send({ code: "anomaly_closed", message: "Cette anomalie est clôturée." });
      }
      const updated = await prisma.attendanceAnomaly.update({
        where: { id },
        data: {
          justificationMotif: parsed.data.motif,
          justificationComment: parsed.data.comment ?? null,
          justificationDocumentId: parsed.data.document_id ?? null,
          status: "en_analyse",
        },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "attendance_anomaly",
        entityId: id,
        oldValues: { status: anomaly.status },
        newValues: { status: "en_analyse", motif: parsed.data.motif },
        ipAddress: request.ip,
      });
      return reply.send(anomalyView(updated));
    },
  );

  // Décision sur une anomalie (§25) — valider/rejeter/corriger/annuler/analyser/
  // demander une correction. Réservé aux validateurs, dans leur périmètre.
  fastify.post(
    "/api/v1/attendance/anomalies/:id/decision",
    { preHandler: requirePermission("presences", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z
        .object({
          action: z.enum(["analyser", "valider", "rejeter", "corriger", "annuler", "demander_correction"]),
          comment: z.string().max(2000).optional(),
        })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Action invalide.", details: parsed.error.issues });
      }
      const anomaly = await prisma.attendanceAnomaly.findUnique({ where: { id } });
      if (!anomaly) return reply.code(404).send({ code: "not_found", message: "Anomalie introuvable." });
      if (!(await canActOnEmployee(request.user!, anomaly.employeeId))) {
        return reply.code(403).send({ code: "forbidden", message: "Hors de votre périmètre de validation." });
      }
      const action = parsed.data.action as AnomalyAction;
      if (!canTransition(anomaly.status, action)) {
        return reply.code(409).send({ code: "invalid_transition", message: `Décision « ${action} » impossible depuis le statut « ${anomaly.status} ».` });
      }
      const status = nextStatus(action);
      const resolved = ["valider", "rejeter", "annuler"].includes(action);
      const updated = await prisma.attendanceAnomaly.update({
        where: { id },
        data: {
          status,
          justificationComment: parsed.data.comment ?? anomaly.justificationComment,
          resolvedBy: resolved ? request.user!.id : anomaly.resolvedBy,
          resolvedAt: resolved ? new Date() : anomaly.resolvedAt,
        },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: action === "valider" ? "validate" : "status_change",
        entityType: "attendance_anomaly",
        entityId: id,
        oldValues: { status: anomaly.status },
        newValues: { status, action },
        ipAddress: request.ip,
      });
      return reply.send(anomalyView(updated));
    },
  );

  // Niveaux du circuit de validation (§25-26) — paramétrables.
  fastify.get(
    "/api/v1/attendance/validation-levels",
    { preHandler: requirePermission("presences", "consultation") },
    async (_request, reply) => {
      const rows = await prisma.attendanceValidationLevel.findMany({ orderBy: { position: "asc" } });
      return reply.send(rows.map((l) => ({ code: l.code, label: l.label, position: l.position, mode: l.mode })));
    },
  );

  fastify.put(
    "/api/v1/attendance/validation-levels/:code",
    { preHandler: requirePermission("presences", "administration") },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const parsed = z
        .object({ mode: z.enum(["obligatoire", "facultatif", "desactive"]).optional(), position: z.number().int().min(1).optional(), label: z.string().max(60).optional() })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const existing = await prisma.attendanceValidationLevel.findUnique({ where: { code } });
      if (!existing) return reply.code(404).send({ code: "not_found", message: "Niveau inconnu." });
      const updated = await prisma.attendanceValidationLevel.update({
        where: { code },
        data: { mode: parsed.data.mode ?? existing.mode, position: parsed.data.position ?? existing.position, label: parsed.data.label ?? existing.label, updatedBy: request.user!.id },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "attendance_validation_level",
        entityId: code,
        oldValues: { mode: existing.mode, position: existing.position },
        newValues: { mode: updated.mode, position: updated.position },
        ipAddress: request.ip,
      });
      return reply.send({ code: updated.code, label: updated.label, position: updated.position, mode: updated.mode });
    },
  );

  // ----- Rapports & tableau de bord (§20, §32-33) ----------------------------

  // Rapport mensuel RH : une ligne par employé (temps travaillé, retards,
  // absences, heures sup, retenue proposée). Réservé aux profils de supervision.
  fastify.get(
    "/api/v1/attendance/report/monthly",
    { preHandler: requirePermission("presences", "consultation") },
    async (request, reply) => {
      if (!canSeeOthers(request.user!)) {
        return reply.code(403).send({ code: "forbidden", message: "Rapport réservé aux responsables (RH, chef, direction)." });
      }
      const query = request.query as { from?: string; to?: string; department_id?: string };
      const { from, to } = monthDefault(query.from, query.to);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
        return reply.code(400).send({ code: "validation_error", message: "Période invalide." });
      }
      const report = await computeBatchReport(from, to, query.department_id ?? null);
      return reply.send(report);
    },
  );

  // Tableau de bord RH : indicateurs du jour + retenues du mois en cours.
  fastify.get(
    "/api/v1/attendance/dashboard",
    { preHandler: requirePermission("presences", "consultation") },
    async (request, reply) => {
      if (!canSeeOthers(request.user!)) {
        return reply.code(403).send({ code: "forbidden", message: "Tableau de bord réservé aux responsables." });
      }
      const query = request.query as { date?: string };
      const date = query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : todayKey();
      const monthStart = `${date.slice(0, 7)}-01`;
      const [dayReport, monthReport] = await Promise.all([
        computeBatchReport(date, date, null),
        computeBatchReport(monthStart, date, null),
      ]);
      const headcount = dayReport.rows.length;
      const present = dayReport.rows.filter((r) => r.worked_minutes > 0).length;
      const absent = dayReport.rows.filter((r) => r.days_absent_unjustified > 0).length;
      const late = dayReport.rows.filter((r) => r.late_minutes > 0).length;
      const early = dayReport.rows.filter((r) => r.early_leave_minutes > 0).length;
      const overtime = dayReport.rows.reduce((s, r) => s + r.overtime_minutes, 0);
      // Base « attendue » du jour : employés dont c'est un jour ouvrable.
      const expectedToday = dayReport.rows.filter((r) => r.expected_minutes > 0).length;
      const presenceRate = expectedToday > 0 ? Math.round((present / expectedToday) * 1000) / 10 : null;
      const absenteeismRate = expectedToday > 0 ? Math.round((absent / expectedToday) * 1000) / 10 : null;
      return reply.send({
        date,
        headcount,
        present_today: present,
        absent_today: absent,
        late_today: late,
        early_leave_today: early,
        overtime_minutes_today: overtime,
        presence_rate_pct: presenceRate,
        absenteeism_rate_pct: absenteeismRate,
        deduction_month_total: monthReport.totals.deduction_total,
        overtime_minutes_month: monthReport.totals.overtime_minutes,
      });
    },
  );

  // ----- Consolidation vers la paie (§28-31) ---------------------------------

  // Rubriques prises en compte (§29) — activables Oui/Non.
  fastify.get(
    "/api/v1/attendance/payroll/rubrics",
    { preHandler: requirePermission("presences", "consultation") },
    async (request, reply) => {
      if (!canSeeOthers(request.user!)) return reply.code(403).send({ code: "forbidden", message: "Réservé aux responsables." });
      const rows = await prisma.attendancePayrollRubric.findMany({ orderBy: { sortOrder: "asc" } });
      return reply.send(rows.map((r) => ({ code: r.code, label: r.label, enabled: r.enabled })));
    },
  );

  fastify.patch(
    "/api/v1/attendance/payroll/rubrics/:code",
    { preHandler: requirePermission("presences", "administration") },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const parsed = z.object({ enabled: z.boolean() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides." });
      const existing = await prisma.attendancePayrollRubric.findUnique({ where: { code } });
      if (!existing) return reply.code(404).send({ code: "not_found", message: "Rubrique inconnue." });
      const updated = await prisma.attendancePayrollRubric.update({ where: { code }, data: { enabled: parsed.data.enabled, updatedBy: request.user!.id } });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "attendance_payroll_rubric", entityId: code, oldValues: { enabled: existing.enabled }, newValues: { enabled: updated.enabled }, ipAddress: request.ip });
      return reply.send({ code: updated.code, label: updated.label, enabled: updated.enabled });
    },
  );

  // Mode d'intégration à la paie (§28) : auto | manuel.
  fastify.get(
    "/api/v1/attendance/payroll/mode",
    { preHandler: requirePermission("presences", "consultation") },
    async (request, reply) => {
      if (!canSeeOthers(request.user!)) return reply.code(403).send({ code: "forbidden", message: "Réservé aux responsables." });
      const s = await prisma.setting.findUnique({ where: { key: "attendance_payroll_mode" } });
      return reply.send({ mode: (s?.value as string) ?? "manuel" });
    },
  );

  fastify.put(
    "/api/v1/attendance/payroll/mode",
    { preHandler: requirePermission("presences", "administration") },
    async (request, reply) => {
      const parsed = z.object({ mode: z.enum(["auto", "manuel"]) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Mode invalide (auto|manuel)." });
      await prisma.setting.upsert({ where: { key: "attendance_payroll_mode" }, update: { value: parsed.data.mode }, create: { key: "attendance_payroll_mode", value: parsed.data.mode } });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "attendance_payroll_mode", entityId: "attendance_payroll_mode", newValues: { mode: parsed.data.mode }, ipAddress: request.ip });
      return reply.send({ mode: parsed.data.mode });
    },
  );

  // Préparation d'une consolidation pour une période « AAAA-MM » : calcule et
  // fige un instantané par employé. Refusé si la période est déjà gelée.
  fastify.post(
    "/api/v1/attendance/payroll/:periodKey/prepare",
    { preHandler: requirePermission("presences", "validation") },
    async (request, reply) => {
      const { periodKey } = request.params as { periodKey: string };
      if (!/^\d{4}-\d{2}$/.test(periodKey)) return reply.code(400).send({ code: "validation_error", message: "Période attendue au format AAAA-MM." });
      const existing = await prisma.attendancePayrollPeriod.findUnique({ where: { periodKey } });
      if (existing && (existing.status === "gele" || existing.status === "transmis")) {
        return reply.code(409).send({ code: "period_frozen", message: "Cette période est figée : elle ne peut plus être recalculée." });
      }
      const { from, to } = periodRange(periodKey);
      const report = await computeBatchReport(from, to, null);
      const modeSetting = await prisma.setting.findUnique({ where: { key: "attendance_payroll_mode" } });
      const mode = (modeSetting?.value as string) ?? "manuel";

      const period = await prisma.$transaction(async (tx) => {
        const p = await tx.attendancePayrollPeriod.upsert({
          where: { periodKey },
          update: { status: "brouillon", mode, preparedBy: request.user!.id, fromDate: new Date(`${from}T00:00:00.000Z`), toDate: new Date(`${to}T00:00:00.000Z`) },
          create: { periodKey, fromDate: new Date(`${from}T00:00:00.000Z`), toDate: new Date(`${to}T00:00:00.000Z`), status: "brouillon", mode, preparedBy: request.user!.id },
        });
        await tx.attendancePayrollLine.deleteMany({ where: { periodId: p.id } });
        for (const r of report.rows) {
          await tx.attendancePayrollLine.create({
            data: {
              periodId: p.id,
              employeeId: r.employee_id,
              workedMinutes: r.worked_minutes,
              lateMinutes: r.late_minutes,
              earlyLeaveMinutes: r.early_leave_minutes,
              overtimeMinutes: r.overtime_minutes,
              daysWorked: r.days_worked,
              daysAbsentUnjustified: r.days_absent_unjustified,
              daysAbsentJustified: r.days_absent_justified,
              deductionProposed: r.deduction_proposed,
            },
          });
        }
        return p;
      }, { timeout: 120000, maxWait: 15000 });
      await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "attendance_payroll_period", entityId: periodKey, newValues: { from, to, lines: report.rows.length, mode }, ipAddress: request.ip });
      return reply.send({ period_key: periodKey, status: period.status, mode, lines: report.rows.length });
    },
  );

  // Récapitulatif d'une consolidation (§30) : lignes figées + totaux + rubriques.
  fastify.get(
    "/api/v1/attendance/payroll/:periodKey",
    { preHandler: requirePermission("presences", "consultation") },
    async (request, reply) => {
      if (!canSeeOthers(request.user!)) return reply.code(403).send({ code: "forbidden", message: "Réservé aux responsables." });
      const { periodKey } = request.params as { periodKey: string };
      const period = await prisma.attendancePayrollPeriod.findUnique({
        where: { periodKey },
        include: { lines: { include: { employee: { select: { firstName: true, lastName: true } } }, orderBy: { employee: { lastName: "asc" } } } },
      });
      if (!period) return reply.code(404).send({ code: "not_found", message: "Aucune consolidation pour cette période." });
      const rubrics = await prisma.attendancePayrollRubric.findMany({ orderBy: { sortOrder: "asc" } });
      const totals = period.lines.reduce(
        (acc, l) => {
          acc.worked_minutes += l.workedMinutes;
          acc.overtime_minutes += l.overtimeMinutes;
          acc.days_absent_unjustified += l.daysAbsentUnjustified;
          acc.deduction_total += Number(l.deductionProposed);
          return acc;
        },
        { worked_minutes: 0, overtime_minutes: 0, days_absent_unjustified: 0, deduction_total: 0 },
      );
      return reply.send({
        period_key: period.periodKey,
        from: period.fromDate.toISOString().slice(0, 10),
        to: period.toDate.toISOString().slice(0, 10),
        status: period.status,
        mode: period.mode,
        validated_at: period.validatedAt,
        frozen_at: period.frozenAt,
        transmitted_at: period.transmittedAt,
        rubrics: rubrics.map((r) => ({ code: r.code, label: r.label, enabled: r.enabled })),
        totals,
        lines: period.lines.map((l) => ({
          employee_id: l.employeeId,
          employee_name: `${l.employee.firstName} ${l.employee.lastName}`,
          worked_minutes: l.workedMinutes,
          late_minutes: l.lateMinutes,
          early_leave_minutes: l.earlyLeaveMinutes,
          overtime_minutes: l.overtimeMinutes,
          days_worked: l.daysWorked,
          days_absent_unjustified: l.daysAbsentUnjustified,
          deduction_proposed: Number(l.deductionProposed),
        })),
      });
    },
  );

  // Validation (contrôle du gestionnaire) puis gel (§30). Transitions strictes.
  fastify.post(
    "/api/v1/attendance/payroll/:periodKey/validate",
    { preHandler: requirePermission("presences", "validation") },
    async (request, reply) => {
      const { periodKey } = request.params as { periodKey: string };
      const period = await prisma.attendancePayrollPeriod.findUnique({ where: { periodKey } });
      if (!period) return reply.code(404).send({ code: "not_found", message: "Période introuvable." });
      if (period.status !== "brouillon") return reply.code(409).send({ code: "invalid_transition", message: `Validation impossible depuis « ${period.status} ».` });
      const updated = await prisma.attendancePayrollPeriod.update({ where: { periodKey }, data: { status: "valide", validatedBy: request.user!.id, validatedAt: new Date() } });
      await writeAuditLog({ userId: request.user!.id, action: "validate", entityType: "attendance_payroll_period", entityId: periodKey, newValues: { status: "valide" }, ipAddress: request.ip });
      return reply.send({ period_key: periodKey, status: updated.status });
    },
  );

  fastify.post(
    "/api/v1/attendance/payroll/:periodKey/freeze",
    { preHandler: requirePermission("presences", "validation") },
    async (request, reply) => {
      const { periodKey } = request.params as { periodKey: string };
      const period = await prisma.attendancePayrollPeriod.findUnique({ where: { periodKey } });
      if (!period) return reply.code(404).send({ code: "not_found", message: "Période introuvable." });
      if (period.status !== "valide") return reply.code(409).send({ code: "invalid_transition", message: "La période doit être validée avant d'être gelée." });
      const updated = await prisma.attendancePayrollPeriod.update({ where: { periodKey }, data: { status: "gele", frozenAt: new Date() } });
      await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "attendance_payroll_period", entityId: periodKey, newValues: { status: "gele" }, ipAddress: request.ip });
      return reply.send({ period_key: periodKey, status: updated.status });
    },
  );

  // Transmission à la paie (§28) : alimente les VARIABLES DE PAIE existantes
  // pour les seules rubriques activées. Ne modifie jamais un bulletin.
  fastify.post(
    "/api/v1/attendance/payroll/:periodKey/transmit",
    { preHandler: requirePermission("presences", "administration") },
    async (request, reply) => {
      const { periodKey } = request.params as { periodKey: string };
      const period = await prisma.attendancePayrollPeriod.findUnique({ where: { periodKey }, include: { lines: true } });
      if (!period) return reply.code(404).send({ code: "not_found", message: "Période introuvable." });
      if (period.status !== "gele") return reply.code(409).send({ code: "not_frozen", message: "La période doit être gelée avant transmission à la paie." });
      const rubrics = await prisma.attendancePayrollRubric.findMany();
      const on = (code: string) => rubrics.find((r) => r.code === code)?.enabled ?? false;

      await prisma.$transaction(async (tx) => {
        for (const l of period.lines) {
          await tx.payrollVariable.upsert({
            where: { employeeId_periodKey: { employeeId: l.employeeId, periodKey } },
            update: {
              // Une rubrique désactivée efface la variable (null), pour refléter
              // exactement la configuration courante — pas « laisser inchangé ».
              presenceDays: on("heures_travaillees") ? l.daysWorked : null,
              absenceDays: on("absences") ? l.daysAbsentUnjustified : null,
              deductionAmount: on("retenues") ? l.deductionProposed : null,
              overtimeMinutes: on("heures_supplementaires") ? l.overtimeMinutes : null,
              exportedAt: new Date(),
            },
            create: {
              employeeId: l.employeeId,
              periodKey,
              presenceDays: on("heures_travaillees") ? l.daysWorked : null,
              absenceDays: on("absences") ? l.daysAbsentUnjustified : null,
              deductionAmount: on("retenues") ? l.deductionProposed : null,
              overtimeMinutes: on("heures_supplementaires") ? l.overtimeMinutes : null,
              exportedAt: new Date(),
              createdBy: request.user!.id,
            },
          });
        }
        await tx.attendancePayrollPeriod.update({ where: { periodKey }, data: { status: "transmis", transmittedAt: new Date() } });
      }, { timeout: 120000, maxWait: 15000 });
      await writeAuditLog({ userId: request.user!.id, action: "export", entityType: "attendance_payroll_period", entityId: periodKey, newValues: { transmitted: period.lines.length }, ipAddress: request.ip });
      return reply.send({ period_key: periodKey, status: "transmis", transmitted: period.lines.length });
    },
  );

  // Petit point d'entrée de santé du module (utile aux futurs tableaux de bord).
  fastify.get("/api/v1/attendance/ping", { preHandler: requireAuth }, async (_request, reply) => {
    return reply.send({ module: "presences", ok: true });
  });
}

function periodRange(periodKey: string): { from: string; to: string } {
  const [y, m] = periodKey.split("-").map(Number);
  const from = `${periodKey}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from, to };
}

// ----- Rapport par lot (performant : lectures groupées, calcul en mémoire) --

function parseDays(csv: string): number[] {
  return csv.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
}

interface BatchScheduleRow {
  scope: string;
  departmentId: string | null;
  employeeId: string | null;
  dayStartMin: number;
  lunchStartMin: number;
  lunchEndMin: number;
  dayEndMin: number;
  workingDays: string;
  effectiveFrom: Date;
}

// Horaire applicable à un employé, résolu EN MÉMOIRE (employé > département >
// maison > défaut) à partir de la liste chargée une seule fois.
function pickSchedule(schedules: BatchScheduleRow[], employeeId: string, departmentId: string | null, onDate: Date) {
  const applicable = schedules.filter((s) => s.effectiveFrom <= onDate);
  const best = (scope: string, matchId: string | null) =>
    applicable
      .filter((s) => s.scope === scope && (scope === "company" || (scope === "department" ? s.departmentId === matchId : s.employeeId === matchId)))
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
  const chosen = best("employee", employeeId) ?? (departmentId ? best("department", departmentId) : undefined) ?? best("company", null);
  if (!chosen) {
    return {
      dayStartMin: DEFAULT_SCHEDULE.dayStartMin,
      lunchStartMin: DEFAULT_SCHEDULE.lunchStartMin,
      lunchEndMin: DEFAULT_SCHEDULE.lunchEndMin,
      dayEndMin: DEFAULT_SCHEDULE.dayEndMin,
      workingDays: parseDays(DEFAULT_SCHEDULE.workingDays),
    };
  }
  return {
    dayStartMin: chosen.dayStartMin,
    lunchStartMin: chosen.lunchStartMin,
    lunchEndMin: chosen.lunchEndMin,
    dayEndMin: chosen.dayEndMin,
    workingDays: parseDays(chosen.workingDays),
  };
}

export interface ReportRow {
  employee_id: string;
  employee_name: string;
  department: string | null;
  worked_minutes: number;
  expected_minutes: number;
  late_minutes: number;
  early_leave_minutes: number;
  overtime_minutes: number;
  days_worked: number;
  days_absent_unjustified: number;
  days_absent_justified: number;
  deduction_proposed: number;
}

// Retenue des absences sur la paie : DÉSACTIVÉE par défaut (décision opérateur
// du 30/07/2026). Activable seulement si la maison dispose d'un vrai pointeur /
// registre de présence fiable — la simple connexion Eclospace ne suffit pas à
// justifier une retenue sur salaire.
async function deductAbsencesEnabled(): Promise<boolean> {
  const s = await prisma.setting.findUnique({ where: { key: "presences.deduct_absences" } });
  return s?.value === true;
}

async function computeBatchReport(from: string, to: string, departmentId: string | null) {
  const offset = await businessOffsetMinutes();
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const fromUtc = new Date(fromDate);
  fromUtc.setUTCDate(fromUtc.getUTCDate() - 1);
  const toUtc = new Date(toDate);
  toUtc.setUTCDate(toUtc.getUTCDate() + 2);

  const [employees, schedules, holidays, rule, events, absences, deductAbsences] = await Promise.all([
    prisma.employee.findMany({ where: { deletedAt: null, ...(departmentId ? { departmentId } : {}) }, include: { department: true } }),
    prisma.workSchedule.findMany({ where: { deletedAt: null, active: true, effectiveFrom: { lte: toDate } } }),
    prisma.publicHoliday.findMany({ where: { day: { gte: fromDate, lte: toDate } }, select: { day: true } }),
    resolveDeductionRule(toDate),
    prisma.attendanceEvent.findMany({ where: { occurredAt: { gte: fromUtc, lte: toUtc }, employeeId: { not: null } }, select: { employeeId: true, kind: true, occurredAt: true } }),
    prisma.absence.findMany({ where: { status: "validee", fromDate: { lte: new Date(`${to}T23:59:59.000Z`) }, toDate: { gte: fromDate } }, select: { employeeId: true, type: true, fromDate: true, toDate: true } }),
    deductAbsencesEnabled(),
  ]);

  const holidaySet = new Set(holidays.map((h) => h.day.toISOString().slice(0, 10)));
  const eventsByEmp = new Map<string, Map<string, DayEvent[]>>();
  for (const e of events) {
    if (!e.employeeId) continue;
    const { dayKey, minutes } = toLocal(e.occurredAt, offset);
    if (!eventsByEmp.has(e.employeeId)) eventsByEmp.set(e.employeeId, new Map());
    const m = eventsByEmp.get(e.employeeId)!;
    if (!m.has(dayKey)) m.set(dayKey, []);
    m.get(dayKey)!.push({ kind: e.kind, localMinutes: minutes });
  }
  const absencesByEmp = new Map<string, { type: string; fromDate: Date; toDate: Date }[]>();
  for (const a of absences) {
    if (!absencesByEmp.has(a.employeeId)) absencesByEmp.set(a.employeeId, []);
    absencesByEmp.get(a.employeeId)!.push(a);
  }

  const dayKeys = eachDay(from, to);
  const rows: ReportRow[] = [];
  for (const emp of employees) {
    const sched = pickSchedule(schedules as BatchScheduleRow[], emp.id, emp.departmentId, toDate);
    const empEvents = eventsByEmp.get(emp.id) ?? new Map<string, DayEvent[]>();
    const empAbs = absencesByEmp.get(emp.id) ?? [];
    const days = dayKeys.map((dayKey) => {
      const ds = new Date(`${dayKey}T00:00:00.000Z`);
      const de = new Date(`${dayKey}T23:59:59.000Z`);
      const cov = empAbs.find((x) => x.fromDate <= de && x.toDate >= ds);
      return computeDay({
        date: dayKey,
        isoWeekday: isoWeekday(dayKey),
        events: empEvents.get(dayKey) ?? [],
        schedule: sched,
        isHoliday: holidaySet.has(dayKey),
        covering: cov ? { type: cov.type } : null,
      });
    });
    const summary = summarize(from, to, days);
    const ded = rule ? computeDeduction(days, rule, deductAbsences).total_deduction : 0;
    rows.push({
      employee_id: emp.id,
      employee_name: `${emp.firstName} ${emp.lastName}`,
      department: emp.department?.name ?? null,
      worked_minutes: summary.totals.worked_minutes,
      expected_minutes: summary.totals.expected_minutes,
      late_minutes: summary.totals.late_minutes,
      early_leave_minutes: summary.totals.early_leave_minutes,
      overtime_minutes: summary.totals.overtime_minutes,
      days_worked: summary.totals.days_worked,
      days_absent_unjustified: summary.totals.days_absent_unjustified,
      days_absent_justified: summary.totals.days_absent_justified,
      deduction_proposed: ded,
    });
  }
  rows.sort((a, b) => a.employee_name.localeCompare(b.employee_name, "fr"));

  const totals = rows.reduce(
    (acc, r) => {
      acc.worked_minutes += r.worked_minutes;
      acc.late_minutes += r.late_minutes;
      acc.early_leave_minutes += r.early_leave_minutes;
      acc.overtime_minutes += r.overtime_minutes;
      acc.days_absent_unjustified += r.days_absent_unjustified;
      acc.deduction_total += r.deduction_proposed;
      return acc;
    },
    { worked_minutes: 0, late_minutes: 0, early_leave_minutes: 0, overtime_minutes: 0, days_absent_unjustified: 0, deduction_total: 0 },
  );

  return { from, to, headcount: rows.length, rows, totals };
}

// ----- Anomalies : vue, seuils, périmètre ----------------------------------

function anomalyView(a: {
  id: string;
  employeeId: string;
  day: Date;
  type: string;
  minutes: number | null;
  detail: string | null;
  status: string;
  justificationMotif: string | null;
  justificationComment: string | null;
  resolvedAt: Date | null;
  employee?: { firstName: string; lastName: string };
}) {
  return {
    id: a.id,
    employee_id: a.employeeId,
    employee_name: a.employee ? `${a.employee.firstName} ${a.employee.lastName}` : undefined,
    day: a.day.toISOString().slice(0, 10),
    type: a.type,
    minutes: a.minutes,
    detail: a.detail,
    status: a.status,
    justification_motif: a.justificationMotif,
    justification_comment: a.justificationComment,
    resolved_at: a.resolvedAt,
  };
}

async function anomalyThresholds() {
  const late = await prisma.setting.findUnique({ where: { key: "presence_anomaly_late_minutes" } });
  const early = await prisma.setting.findUnique({ where: { key: "presence_anomaly_early_minutes" } });
  const num = (v: unknown, d: number) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) || d : d);
  return { lateMin: num(late?.value, DEFAULT_THRESHOLDS.lateMin), earlyMin: num(early?.value, DEFAULT_THRESHOLDS.earlyMin) };
}

// Grand pôle de l'utilisateur connecté (via le département de sa fiche).
async function userPole(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { employee: { include: { department: true } } } });
  const code = u?.employee?.department?.code ?? null;
  return code ? poleForPresence(code) : null;
}

async function employeePole(employeeId: string): Promise<string | null> {
  const e = await prisma.employee.findUnique({ where: { id: employeeId }, include: { department: true } });
  return e?.department?.code ? poleForPresence(e.department.code) : null;
}

// Qui peut agir (justifier au nom de / décider) sur les anomalies d'un employé.
async function canActOnEmployee(user: { id: string; permissions: Set<string>; roles: string[] }, employeeId: string): Promise<boolean> {
  if (user.permissions.has("presences:validation") || user.permissions.has("presences:administration") || user.permissions.has("direction:consultation")) {
    return true;
  }
  if (user.roles.includes("CHEF_DEPARTEMENT")) {
    const [up, ep] = await Promise.all([userPole(user.id), employeePole(employeeId)]);
    return up !== null && up === ep;
  }
  return false;
}

// Périmètre de lecture de la file d'anomalies.
async function anomalyScope(
  user: { id: string; permissions: Set<string>; roles: string[] },
): Promise<{ kind: "all" } | { kind: "pole"; employeeIds: string[] } | { kind: "self"; employeeId: string | null }> {
  if (user.permissions.has("presences:validation") || user.permissions.has("presences:administration") || user.permissions.has("direction:consultation")) {
    return { kind: "all" };
  }
  if (user.roles.includes("CHEF_DEPARTEMENT")) {
    const pole = await userPole(user.id);
    const employees = await prisma.employee.findMany({ where: { deletedAt: null }, include: { department: true } });
    const ids = employees.filter((e) => e.department?.code && poleForPresence(e.department.code) === pole).map((e) => e.id);
    return { kind: "pole", employeeIds: ids };
  }
  return { kind: "self", employeeId: await ownEmployeeId(user.id) };
}

// ----- Règles de retenues : schéma, vue, résolution ------------------------

const deductionRuleSchema = z.object({
  per_minute: z.number().nonnegative().optional(),
  per_half_hour: z.number().nonnegative().default(500),
  per_hour: z.number().nonnegative().default(1000),
  daily_cap: z.number().nonnegative().optional(),
  monthly_cap: z.number().nonnegative().optional(),
  method: z.enum(["prorata", "round_half_hour", "round_hour", "custom"]).default("prorata"),
  effective_from: z.string().datetime().optional(),
  label: z.string().max(120).optional(),
});

function deductionRuleView(r: {
  id: string;
  perMinute: unknown;
  perHalfHour: unknown;
  perHour: unknown;
  dailyCap: unknown;
  monthlyCap: unknown;
  method: string;
  effectiveFrom: Date;
  active: boolean;
  label: string | null;
}) {
  return {
    id: r.id,
    per_minute: r.perMinute != null ? Number(r.perMinute) : null,
    per_half_hour: Number(r.perHalfHour),
    per_hour: Number(r.perHour),
    daily_cap: r.dailyCap != null ? Number(r.dailyCap) : null,
    monthly_cap: r.monthlyCap != null ? Number(r.monthlyCap) : null,
    method: r.method as DeductionRuleView["method"],
    effective_from: r.effectiveFrom,
    active: r.active,
    label: r.label,
  };
}

// Règle applicable à une date : la plus récente, active, dont la date d'effet
// précède la date visée (versionnage §21).
async function resolveDeductionRule(onDate: Date): Promise<DeductionRuleView | null> {
  const rule = await prisma.deductionRule.findFirst({
    where: { active: true, effectiveFrom: { lte: onDate } },
    orderBy: { effectiveFrom: "desc" },
  });
  return rule ? deductionRuleView(rule) : null;
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
