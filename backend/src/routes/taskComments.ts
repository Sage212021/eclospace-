import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";

const createCommentSchema = z.object({
  body: z.string().min(1),
  is_blocking: z.boolean().default(false),
  document_version_id: z.string().uuid().optional(),
});

// Observations du correcteur (Ch. 10 §10.7) : datées, signées, liées à la
// version concernée ; un point bloquant empêche la validation de la version
// tant qu'il n'est pas levé (voir le contrôle sur l'étape CORRECTION dans workflow.ts).
export default async function taskCommentRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/api/v1/tasks/:id/comments",
    { preHandler: requirePermission("tasks", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = createCommentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const task = await prisma.task.findFirst({ where: { id, deletedAt: null } });
      if (!task) {
        return reply.code(404).send({ code: "not_found", message: "Tâche introuvable." });
      }

      const comment = await prisma.taskComment.create({
        data: {
          taskId: id,
          authorId: request.user!.id,
          body: parsed.data.body,
          isBlocking: parsed.data.is_blocking,
          documentVersionId: parsed.data.document_version_id,
        },
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "task_comment",
        entityId: comment.id,
        newValues: { taskId: id, isBlocking: parsed.data.is_blocking },
        ipAddress: request.ip,
      });

      return reply.code(201).send(comment);
    },
  );

  fastify.get("/api/v1/tasks/:id/comments", { preHandler: requirePermission("tasks", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const comments = await prisma.taskComment.findMany({
      where: { taskId: id },
      include: { author: { select: { id: true, username: true } } },
      orderBy: { createdAt: "asc" },
    });
    return reply.send(comments);
  });

  fastify.patch(
    "/api/v1/task-comments/:id/resolve",
    { preHandler: requirePermission("tasks", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const comment = await prisma.taskComment.findUnique({ where: { id } });
      if (!comment) {
        return reply.code(404).send({ code: "not_found", message: "Observation introuvable." });
      }

      const updated = await prisma.taskComment.update({ where: { id }, data: { resolvedAt: new Date() } });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "task_comment",
        entityId: id,
        newValues: { resolved: true },
        ipAddress: request.ip,
      });

      return reply.send(updated);
    },
  );
}
