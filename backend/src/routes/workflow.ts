import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";

const validateStepSchema = z.object({
  observations: z.string().optional(),
  // Utilisé uniquement par l'étape VERIF_ADMIN (Ch. 4 §4.3, étape 2) : un
  // dossier incomplet bloque le passage à l'étape suivante.
  outcome: z.enum(["conforme", "incomplet"]).default("conforme"),
});

// Étapes pilotées par un flux dédié plutôt que par cet endpoint générique :
// COMITE_LECTURE avance automatiquement quand tous les rapports de lecture
// sont remis (Ch. 7 §7.12) ; DECISION_EDITORIALE se prend via
// /editorial-decision (Ch. 8 §8.2).
const DEDICATED_FLOW_STEPS = new Set(["COMITE_LECTURE", "DECISION_EDITORIALE"]);

// Moteur de workflow générique (Ch. 4 §4.2, §4.5) : impossible de sauter une
// étape — on ne peut valider que l'étape où se trouve actuellement le
// manuscrit, ce qui garantit le séquencement par construction.
export default async function workflowRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/api/v1/manuscripts/:id/steps/:step/validate",
    { preHandler: requirePermission("manuscripts", "validation") },
    async (request, reply) => {
      const { id, step } = request.params as { id: string; step: string };
      const parsed = validateStepSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }

      const targetStatus = await prisma.workflowStatus.findUnique({ where: { code: step } });
      if (!targetStatus) {
        return reply.code(404).send({ code: "not_found", message: `Étape inconnue : ${step}.` });
      }

      if (DEDICATED_FLOW_STEPS.has(targetStatus.code)) {
        return reply.code(409).send({
          code: "dedicated_flow_required",
          message:
            targetStatus.code === "COMITE_LECTURE"
              ? "Cette étape se termine automatiquement quand tous les rapports de lecture attendus sont remis."
              : "Cette étape se valide via la décision éditoriale (POST /manuscripts/{id}/editorial-decision).",
        });
      }

      if (manuscript.statusId !== targetStatus.id) {
        const currentStatus = await prisma.workflowStatus.findUnique({ where: { id: manuscript.statusId } });
        return reply.code(409).send({
          code: "step_out_of_order",
          message: `Le manuscrit est actuellement à l'étape « ${currentStatus?.label} », pas « ${targetStatus.label} ».`,
        });
      }

      const { observations, outcome } = parsed.data;
      const now = new Date();

      if (outcome === "incomplet") {
        await prisma.manuscriptStep.upsert({
          where: { manuscriptId_statusId: { manuscriptId: id, statusId: targetStatus.id } },
          update: { observations, actualEnd: now },
          create: { manuscriptId: id, statusId: targetStatus.id, actualStart: now, actualEnd: now, observations },
        });
        if (manuscript.ownerId) {
          await prisma.notification.create({
            data: {
              userId: manuscript.ownerId,
              type: "autre",
              priority: "high",
              title: "Dossier incomplet",
              body: `Le manuscrit ${manuscript.manuscriptNumber} a un dossier incomplet à l'étape « ${targetStatus.label} ».`,
              entityType: "manuscript",
              entityId: id,
            },
          });
        }
        return reply.send({ advanced: false, message: "Dossier incomplet : passage à l'étape suivante bloqué." });
      }

      const nextStatus = await prisma.workflowStatus.findFirst({ where: { stepOrder: targetStatus.stepOrder + 1 } });

      await prisma.$transaction(async (tx) => {
        await tx.manuscriptStep.upsert({
          where: { manuscriptId_statusId: { manuscriptId: id, statusId: targetStatus.id } },
          update: { validationBy: request.user!.id, validatedAt: now, observations, actualEnd: now },
          create: {
            manuscriptId: id,
            statusId: targetStatus.id,
            validationBy: request.user!.id,
            validatedAt: now,
            actualStart: now,
            actualEnd: now,
            observations,
          },
        });

        if (nextStatus) {
          await tx.manuscript.update({ where: { id }, data: { statusId: nextStatus.id, updatedBy: request.user!.id } });
          await tx.stepTransition.create({
            data: {
              manuscriptId: id,
              fromStatusCode: targetStatus.code,
              toStatusCode: nextStatus.code,
              fromDepartmentId: targetStatus.departmentId,
              toDepartmentId: nextStatus.departmentId,
              responsibleId: request.user!.id,
              observations,
            },
          });

          if (nextStatus.departmentId) {
            const departmentUsers = await tx.user.findMany({
              where: { userRoles: { some: { revokedAt: null, role: { departmentId: nextStatus.departmentId } } }, status: "active" },
            });
            for (const departmentUser of departmentUsers) {
              await tx.notification.create({
                data: {
                  userId: departmentUser.id,
                  type: "affectation",
                  priority: "medium",
                  title: "Nouveau dossier à traiter",
                  body: `Le manuscrit ${manuscript.manuscriptNumber} arrive à l'étape « ${nextStatus.label} ».`,
                  entityType: "manuscript",
                  entityId: id,
                },
              });
            }
          }
        }
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "validate",
        entityType: "manuscript",
        entityId: id,
        oldValues: { statusCode: targetStatus.code },
        newValues: { statusCode: nextStatus?.code ?? null, observations },
        ipAddress: request.ip,
      });

      return reply.send({ advanced: true, status: nextStatus?.code ?? null });
    },
  );
}
