import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";

// Maintenance de cohérence du workflow (demande opérateur 31/08/2026) : un
// ouvrage qu'on a fait AVANCER par erreur puis RECULER pouvait garder des
// « étapes-fantômes » en avance (responsable assigné, tâches de correction
// lingering) → il apparaissait « à plusieurs étapes à la fois ». On détecte ces
// dossiers et on les réaligne sur l'étape la MOINS avancée (leur position
// officielle) en réinitialisant les étapes en avance et en annulant leurs tâches
// non terminées. L'historique validé n'est jamais touché.

// Une étape est « active » si elle a un responsable (ou un démarrage réel) et
// n'est pas encore validée.
const ACTIVE_STEP = { validatedAt: null, OR: [{ responsibleId: { not: null } }, { actualStart: { not: null } }] };

async function findIncoherent() {
  const steps = await prisma.manuscriptStep.findMany({
    where: { ...ACTIVE_STEP, manuscript: { deletedAt: null } },
    include: {
      status: { select: { code: true, label: true, stepOrder: true } },
      responsible: { select: { username: true, employee: { select: { firstName: true, lastName: true } } } },
      manuscript: { select: { id: true, manuscriptNumber: true, title: true, status: { select: { code: true, label: true, stepOrder: true } } } },
    },
  });
  // Ne gardent que les étapes en AVANCE sur la position officielle du manuscrit.
  const ahead = steps.filter((s) => s.status.stepOrder > s.manuscript.status.stepOrder);
  const byManuscript = new Map<string, {
    id: string; number: string; title: string;
    current: { code: string; label: string; order: number };
    stray_steps: { code: string; label: string; order: number; responsible: string | null }[];
  }>();
  for (const s of ahead) {
    const m = s.manuscript;
    if (!byManuscript.has(m.id)) {
      byManuscript.set(m.id, { id: m.id, number: m.manuscriptNumber, title: m.title, current: { code: m.status.code, label: m.status.label, order: m.status.stepOrder }, stray_steps: [] });
    }
    const respName = s.responsible ? `${s.responsible.employee?.firstName ?? ""} ${s.responsible.employee?.lastName ?? ""}`.trim() || s.responsible.username : null;
    byManuscript.get(m.id)!.stray_steps.push({ code: s.status.code, label: s.status.label, order: s.status.stepOrder, responsible: respName });
  }
  return [...byManuscript.values()];
}

export default async function maintenanceRoutes(fastify: FastifyInstance) {
  // Diagnostic (lecture seule) : dossiers présents à plusieurs étapes à la fois.
  fastify.get("/api/v1/maintenance/step-consistency", { preHandler: requirePermission("manuscripts", "administration") }, async (_request, reply) => {
    return reply.send({ manuscripts: await findIncoherent() });
  });

  // Réalignement : pour chaque ouvrage visé, réinitialise les étapes actives en
  // avance et annule leurs tâches non terminées (suppression logique). L'étape
  // officielle (la moins avancée) n'est pas modifiée.
  const realignSchema = z.object({ manuscript_ids: z.array(z.string().uuid()).min(1).optional() });
  fastify.post("/api/v1/maintenance/step-consistency/realign", { preHandler: requirePermission("manuscripts", "administration") }, async (request, reply) => {
    const parsed = realignSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "invalid_body", message: "Requête invalide." });
    const incoherent = await findIncoherent();
    const targets = parsed.data.manuscript_ids ? incoherent.filter((m) => parsed.data.manuscript_ids!.includes(m.id)) : incoherent;

    let stepsReset = 0;
    let tasksCancelled = 0;
    for (const m of targets) {
      const currentOrder = m.current.order;
      const strayStepRows = await prisma.manuscriptStep.findMany({
        where: { manuscriptId: m.id, ...ACTIVE_STEP, status: { stepOrder: { gt: currentOrder } } },
        select: { id: true },
      });
      const stepIds = strayStepRows.map((s) => s.id);
      if (stepIds.length === 0) continue;

      // Réinitialise les étapes-fantômes (remises « non démarrées », sans responsable).
      const r1 = await prisma.manuscriptStep.updateMany({
        where: { id: { in: stepIds } },
        data: { responsibleId: null, plannedStart: null, plannedEnd: null, actualStart: null, actualEnd: null },
      });
      stepsReset += r1.count;

      // Annule (suppression logique) les tâches non terminées rattachées à ces étapes.
      const r2 = await prisma.task.updateMany({
        where: { stepId: { in: stepIds }, deletedAt: null, status: { notIn: ["terminee", "validee"] } },
        data: { deletedAt: new Date(), updatedBy: request.user!.id },
      });
      tasksCancelled += r2.count;

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "manuscript",
        entityId: m.id,
        newValues: { action: "step_consistency_realign", stray_steps: m.stray_steps.map((s) => s.code), realigned_to: m.current.code },
        ipAddress: request.ip,
      });
    }

    return reply.send({ realigned: targets.length, steps_reset: stepsReset, tasks_cancelled: tasksCancelled });
  });
}
