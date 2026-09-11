import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ProjectActivityPriority, ProjectActivityStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";

// Planification du projet (étape PLANIFICATION) : le planning est SAISI dans
// Eclospace et LIÉ au manuscrit (plus de fichier externe à déposer). Un plan par
// manuscrit ; il est remplacé/mis à jour d'un bloc, et `version` s'incrémente à
// chaque enregistrement (traçabilité). L'aperçu et le PDF officiel sont générés
// côté client à partir de ces données.

const optionalDate = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? new Date(v) : null))
  .refine((d) => d === null || !Number.isNaN(d.getTime()), { message: "Date invalide." });

const activitySchema = z.object({
  label: z.string().trim().min(1).max(300),
  responsible: z.string().trim().max(200).optional().nullable(),
  start_date: optionalDate,
  end_date: optionalDate,
  priority: z.nativeEnum(ProjectActivityPriority).default("normale"),
  status: z.nativeEnum(ProjectActivityStatus).default("a_faire"),
  dependencies: z.string().trim().max(1000).optional().nullable(),
  observations: z.string().trim().max(2000).optional().nullable(),
});

const planSchema = z.object({
  manager_name: z.string().trim().max(200).optional().nullable(),
  start_date: optionalDate,
  end_date: optionalDate,
  objectives: z.string().trim().max(4000).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  activities: z.array(activitySchema).max(200).default([]),
});

function view(plan: {
  id: string;
  managerName: string | null;
  startDate: Date | null;
  endDate: Date | null;
  objectives: string | null;
  notes: string | null;
  version: number;
  updatedAt: Date;
  activities: {
    id: string;
    label: string;
    responsible: string | null;
    startDate: Date | null;
    endDate: Date | null;
    priority: ProjectActivityPriority;
    status: ProjectActivityStatus;
    dependencies: string | null;
    observations: string | null;
    displayOrder: number;
  }[];
}) {
  return {
    id: plan.id,
    manager_name: plan.managerName,
    start_date: plan.startDate?.toISOString() ?? null,
    end_date: plan.endDate?.toISOString() ?? null,
    objectives: plan.objectives,
    notes: plan.notes,
    version: plan.version,
    updated_at: plan.updatedAt.toISOString(),
    activities: [...plan.activities]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((a) => ({
        id: a.id,
        label: a.label,
        responsible: a.responsible,
        start_date: a.startDate?.toISOString() ?? null,
        end_date: a.endDate?.toISOString() ?? null,
        priority: a.priority,
        status: a.status,
        dependencies: a.dependencies,
        observations: a.observations,
      })),
  };
}

export default async function projectPlanRoutes(fastify: FastifyInstance) {
  // Lecture du planning d'un manuscrit (null s'il n'y en a pas encore).
  fastify.get(
    "/api/v1/manuscripts/:id/project-plan",
    { preHandler: requirePermission("manuscripts", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      const plan = await prisma.projectPlan.findFirst({ where: { manuscriptId: id, deletedAt: null }, include: { activities: true } });
      return reply.send(plan ? view(plan) : null);
    },
  );

  // Enregistrement (création ou mise à jour) du planning : les activités sont
  // remplacées en bloc dans une transaction ; la version s'incrémente.
  fastify.put(
    "/api/v1/manuscripts/:id/project-plan",
    { preHandler: requirePermission("manuscripts", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = planSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      const d = parsed.data;

      const saved = await prisma.$transaction(async (tx) => {
        const existing = await tx.projectPlan.findFirst({ where: { manuscriptId: id }, select: { id: true, version: true, deletedAt: true } });
        const planData = {
          managerName: d.manager_name ?? null,
          startDate: d.start_date,
          endDate: d.end_date,
          objectives: d.objectives ?? null,
          notes: d.notes ?? null,
          updatedBy: request.user!.id,
        };
        let planId: string;
        if (existing) {
          await tx.projectPlan.update({
            where: { id: existing.id },
            data: { ...planData, version: existing.version + 1, deletedAt: null },
          });
          await tx.projectPlanActivity.deleteMany({ where: { planId: existing.id } });
          planId = existing.id;
        } else {
          const created = await tx.projectPlan.create({
            data: { ...planData, manuscriptId: id, createdBy: request.user!.id },
          });
          planId = created.id;
        }
        if (d.activities.length > 0) {
          await tx.projectPlanActivity.createMany({
            data: d.activities.map((a, i) => ({
              planId,
              label: a.label,
              responsible: a.responsible ?? null,
              startDate: a.start_date,
              endDate: a.end_date,
              priority: a.priority,
              status: a.status,
              dependencies: a.dependencies ?? null,
              observations: a.observations ?? null,
              displayOrder: i,
            })),
          });
        }
        return tx.projectPlan.findUniqueOrThrow({ where: { id: planId }, include: { activities: true } });
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "project_plan",
        entityId: saved.id,
        newValues: { manuscriptId: id, activities: d.activities.length, version: saved.version },
        ipAddress: request.ip,
      });
      return reply.send(view(saved));
    },
  );
}
