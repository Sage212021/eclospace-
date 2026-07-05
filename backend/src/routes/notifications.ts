import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NotificationPriority } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/permissions.js";

const listQuerySchema = z.object({
  unread: z.enum(["true", "false"]).optional(),
  priority: z.nativeEnum(NotificationPriority).optional(),
});

const patchSchema = z.object({
  read: z.boolean(),
});

// Spécification API §2.2. Un utilisateur ne voit que ses propres notifications.
export default async function notificationRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/notifications", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Paramètres invalides.", details: parsed.error.issues });
    }
    const { unread, priority } = parsed.data;

    const notifications = await prisma.notification.findMany({
      where: {
        userId: request.user!.id,
        ...(unread === "true" ? { readAt: null } : {}),
        ...(unread === "false" ? { readAt: { not: null } } : {}),
        ...(priority ? { priority } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(notifications);
  });

  fastify.patch("/api/v1/notifications/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }

    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification || notification.userId !== request.user!.id) {
      return reply.code(404).send({ code: "not_found", message: "Notification introuvable." });
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { readAt: parsed.data.read ? new Date() : null },
    });
    return reply.send(updated);
  });
}
