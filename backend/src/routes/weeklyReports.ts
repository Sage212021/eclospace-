import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type EffectiveUser } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { poleForPresence } from "../lib/presence.js";

// Rapports hebdomadaires par agent (Demande opérateur du 11/07/2026). Le circuit
// et les règles de confidentialité reprennent le modèle « présence/names » :
//   • Direction générale (permission « direction:consultation ») + super-admin :
//     voient TOUT et (selon paramétrage) valident ;
//   • Chef de département (rôle CHEF_DEPARTEMENT) : son propre grand pôle ;
//   • tout autre agent : uniquement SES rapports (self-service).
// Deux réglages (table `settings`) : mode de validation (DG/chef) et périodicité.
const CHEF_ROLE = "CHEF_DEPARTEMENT";

function isOversight(user: EffectiveUser): boolean {
  return user.permissions.has("direction:consultation");
}
function isChef(user: EffectiveUser): boolean {
  return user.roles.includes(CHEF_ROLE);
}

// Grand pôle de l'utilisateur, déduit de sa fiche employé (repli « Administration »).
async function userPole(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: { employee: { include: { department: true } } },
  });
  return poleForPresence(u?.employee?.department?.code ?? null);
}

async function getSettingString(key: string, fallback: string): Promise<string> {
  const s = await prisma.setting.findUnique({ where: { key } });
  return typeof s?.value === "string" ? s.value : fallback;
}

// Période courante selon la périodicité paramétrée (lundi comme début de semaine).
function computePeriod(periodicity: string, ref = new Date()): { start: Date; end: Date } {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  if (periodicity === "monthly") {
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return { start, end };
  }
  // weekly / biweekly : on part du lundi de la semaine de référence.
  const day = (d.getUTCDay() + 6) % 7; // 0 = lundi
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - day);
  const span = periodicity === "biweekly" ? 13 : 6;
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + span);
  return { start, end };
}

const objectiveSchema = z.object({
  user_id: z.string().uuid(),
  title: z.string().trim().min(2).max(300),
  description: z.string().max(2000).optional(),
  target_value: z.number().nonnegative().optional(),
  unit: z.string().max(60).optional(),
  period_start: z.coerce.date(),
  period_end: z.coerce.date(),
  weight: z.number().int().min(1).max(100).optional(),
});

const reportObjectiveLineSchema = z.object({
  objective_id: z.string().uuid().optional(),
  label: z.string().max(300).optional(),
  progress_pct: z.number().int().min(0).max(100),
  comment: z.string().max(1000).optional(),
});

const patchReportSchema = z.object({
  achievements: z.string().max(6000).optional(),
  research: z.string().max(6000).optional(),
  difficulties: z.string().max(6000).optional(),
  next_plan: z.string().max(6000).optional(),
  objectives: z.array(reportObjectiveLineSchema).optional(),
});

const validateSchema = z.object({
  decision: z.enum(["validate", "return"]),
  comment: z.string().max(2000).optional(),
});

const reportInclude = {
  user: { select: { id: true, username: true } },
  objectives: { include: { objective: { select: { id: true, title: true, targetValue: true, unit: true } } } },
  validatedBy: { select: { id: true, username: true } },
} as const;

export default async function weeklyReportRoutes(fastify: FastifyInstance) {
  // --- Objectifs ------------------------------------------------------------
  // Fixés par un chef de département (son pôle) ou la Direction générale.
  fastify.post("/api/v1/objectives", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;
    if (!isOversight(user) && !isChef(user)) {
      await denied(request, "objective:create");
      return reply.code(403).send({ code: "forbidden", message: "Seuls un chef de département ou la Direction générale fixent des objectifs." });
    }
    const parsed = objectiveSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const body = parsed.data;
    // Un chef ne fixe des objectifs qu'aux agents de son propre pôle.
    if (!isOversight(user)) {
      const [chefPole, targetPole] = await Promise.all([userPole(user.id), userPole(body.user_id)]);
      if (chefPole !== targetPole) {
        return reply.code(403).send({ code: "forbidden", message: "Vous ne pouvez fixer d'objectifs qu'aux agents de votre pôle." });
      }
    }
    const objective = await prisma.objective.create({
      data: {
        userId: body.user_id,
        title: body.title,
        description: body.description,
        targetValue: body.target_value,
        unit: body.unit,
        periodStart: body.period_start,
        periodEnd: body.period_end,
        weight: body.weight ?? 1,
        createdBy: user.id,
      },
    });
    await writeAuditLog({ userId: user.id, action: "create", entityType: "objective", entityId: objective.id, newValues: { userId: body.user_id, title: body.title }, ipAddress: request.ip });
    return reply.code(201).send(objective);
  });

  fastify.get("/api/v1/objectives", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as { user_id?: string; status?: string };
    const where: Record<string, unknown> = { deletedAt: null, ...(q.status ? { status: q.status } : {}) };
    if (isOversight(user)) {
      if (q.user_id) where.userId = q.user_id;
    } else if (isChef(user)) {
      // Objectifs de son pôle : filtrés en mémoire (volumétrie modeste).
      const chefPole = await userPole(user.id);
      const all = await prisma.objective.findMany({ where, include: { user: { select: { id: true, username: true } } }, orderBy: { createdAt: "desc" } });
      const filtered = [];
      for (const o of all) {
        if ((await userPole(o.userId)) === chefPole) filtered.push(o);
      }
      return reply.send(filtered);
    } else {
      where.userId = user.id; // agent : ses propres objectifs
    }
    const objectives = await prisma.objective.findMany({ where, include: { user: { select: { id: true, username: true } } }, orderBy: { createdAt: "desc" } });
    return reply.send(objectives);
  });

  // --- Rapports hebdomadaires ----------------------------------------------
  // Crée (ou récupère) le rapport de l'agent pour la période courante.
  fastify.post("/api/v1/weekly-reports", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;
    const periodicity = await getSettingString("weekly_report_periodicity", "weekly");
    const { start, end } = computePeriod(periodicity);
    const pole = await userPole(user.id);

    const existing = await prisma.weeklyReport.findFirst({ where: { userId: user.id, periodStart: start, deletedAt: null }, include: reportInclude });
    if (existing) return reply.send(existing);

    const report = await prisma.weeklyReport.create({
      data: { userId: user.id, pole, periodStart: start, periodEnd: end },
      include: reportInclude,
    });
    return reply.code(201).send(report);
  });

  fastify.get("/api/v1/weekly-reports", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as { status?: string; user_id?: string };
    const where: Record<string, unknown> = { deletedAt: null, ...(q.status ? { status: q.status } : {}) };
    if (isOversight(user)) {
      if (q.user_id) where.userId = q.user_id;
    } else if (isChef(user)) {
      where.pole = await userPole(user.id);
    } else {
      where.userId = user.id;
    }
    const reports = await prisma.weeklyReport.findMany({ where, include: reportInclude, orderBy: { periodStart: "desc" } });
    return reply.send(reports);
  });

  fastify.get("/api/v1/weekly-reports/:id", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const report = await prisma.weeklyReport.findFirst({ where: { id, deletedAt: null }, include: reportInclude });
    if (!report) return reply.code(404).send({ code: "not_found", message: "Rapport introuvable." });
    if (!(await canView(user, report))) {
      await denied(request, "weekly_report:view");
      return reply.code(403).send({ code: "forbidden", message: "Ce rapport n'est pas dans votre périmètre." });
    }
    return reply.send(report);
  });

  // Édition du contenu (l'auteur, tant que le rapport n'est pas validé).
  fastify.patch("/api/v1/weekly-reports/:id", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const parsed = patchReportSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const report = await prisma.weeklyReport.findFirst({ where: { id, deletedAt: null } });
    if (!report) return reply.code(404).send({ code: "not_found", message: "Rapport introuvable." });
    if (report.userId !== user.id) {
      return reply.code(403).send({ code: "forbidden", message: "Seul l'auteur peut modifier son rapport." });
    }
    if (report.status !== "draft" && report.status !== "returned") {
      return reply.code(409).send({ code: "not_editable", message: "Un rapport soumis ou validé n'est plus modifiable." });
    }
    const b = parsed.data;
    await prisma.$transaction(async (tx) => {
      await tx.weeklyReport.update({
        where: { id },
        data: {
          achievements: b.achievements ?? report.achievements,
          research: b.research ?? report.research,
          difficulties: b.difficulties ?? report.difficulties,
          nextPlan: b.next_plan ?? report.nextPlan,
        },
      });
      if (b.objectives) {
        await tx.weeklyReportObjective.deleteMany({ where: { reportId: id } });
        for (const l of b.objectives) {
          await tx.weeklyReportObjective.create({
            data: { reportId: id, objectiveId: l.objective_id ?? null, label: l.label ?? null, progressPct: l.progress_pct, comment: l.comment ?? null },
          });
        }
      }
    });
    const updated = await prisma.weeklyReport.findUnique({ where: { id }, include: reportInclude });
    return reply.send(updated);
  });

  fastify.post("/api/v1/weekly-reports/:id/submit", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const report = await prisma.weeklyReport.findFirst({ where: { id, deletedAt: null } });
    if (!report) return reply.code(404).send({ code: "not_found", message: "Rapport introuvable." });
    if (report.userId !== user.id) {
      return reply.code(403).send({ code: "forbidden", message: "Seul l'auteur peut soumettre son rapport." });
    }
    if (report.status !== "draft" && report.status !== "returned") {
      return reply.code(409).send({ code: "invalid_status", message: "Ce rapport ne peut pas être soumis dans son état actuel." });
    }
    const updated = await prisma.weeklyReport.update({ where: { id }, data: { status: "submitted", submittedAt: new Date() }, include: reportInclude });
    await writeAuditLog({ userId: user.id, action: "status_change", entityType: "weekly_report", entityId: id, newValues: { status: "submitted" }, ipAddress: request.ip });
    return reply.send(updated);
  });

  // Validation / retour — selon le mode paramétré (DG ou chef de département).
  fastify.post("/api/v1/weekly-reports/:id/validate", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const parsed = validateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const report = await prisma.weeklyReport.findFirst({ where: { id, deletedAt: null } });
    if (!report) return reply.code(404).send({ code: "not_found", message: "Rapport introuvable." });
    if (report.status !== "submitted") {
      return reply.code(409).send({ code: "invalid_status", message: "Seul un rapport soumis peut être validé ou retourné." });
    }
    if (!(await canValidate(user, report))) {
      await denied(request, "weekly_report:validate");
      return reply.code(403).send({ code: "forbidden", message: "Vous n'êtes pas habilité à valider ce rapport." });
    }
    const validated = parsed.data.decision === "validate";
    const updated = await prisma.weeklyReport.update({
      where: { id },
      data: {
        status: validated ? "validated" : "returned",
        validatedById: user.id,
        validatedAt: new Date(),
        validationComment: parsed.data.comment ?? null,
      },
      include: reportInclude,
    });
    await writeAuditLog({ userId: user.id, action: "status_change", entityType: "weekly_report", entityId: id, newValues: { status: updated.status }, ipAddress: request.ip });
    return reply.send(updated);
  });
}

// Périmètre de lecture d'un rapport : l'auteur, le chef du pôle, ou l'oversight.
async function canView(user: EffectiveUser, report: { userId: string; pole: string }): Promise<boolean> {
  if (report.userId === user.id) return true;
  if (isOversight(user)) return true;
  if (isChef(user)) return (await userPole(user.id)) === report.pole;
  return false;
}

// Habilitation à valider selon le mode paramétré.
async function canValidate(user: EffectiveUser, report: { pole: string }): Promise<boolean> {
  if (isOversight(user)) return true; // la DG peut toujours valider
  const mode = await getSettingString("weekly_report_validation_mode", "dg");
  if (mode === "chef" && isChef(user)) {
    return (await userPole(user.id)) === report.pole;
  }
  return false;
}

function denied(request: FastifyRequest, entity: string): Promise<void> {
  return writeAuditLog({
    userId: request.user!.id,
    action: "access_denied",
    entityType: "weekly_report",
    entityId: entity,
    newValues: { method: request.method, url: request.url },
    ipAddress: request.ip,
  }).catch(() => {});
}
