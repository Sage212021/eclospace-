import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuditAction } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";

// Journal d'activité inviolable (Ch. 5 §5.8) : lecture seule d'un registre
// append-only alimenté par tous les modules. Aucune route d'écriture ici — les
// lignes sont créées uniquement via writeAuditLog au fil des opérations, et la
// base interdit tout UPDATE/DELETE (migration append_only_constraints).
// Consultation réservée à l'oversight Direction générale (direction:consultation).
const querySchema = z.object({
  entity_type: z.string().min(1).optional(),
  action: z.nativeEnum(AuditAction).optional(),
  user_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export default async function auditRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/api/v1/audit-log",
    { preHandler: requirePermission("direction", "consultation") },
    async (request, reply) => {
      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Filtres invalides.", details: parsed.error.issues });
      }
      const { entity_type, action, user_id, limit, offset } = parsed.data;

      const where = {
        ...(entity_type ? { entityType: entity_type } : {}),
        ...(action ? { action } : {}),
        ...(user_id ? { userId: user_id } : {}),
      };

      const [total, entries] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          orderBy: { occurredAt: "desc" },
          skip: offset,
          take: limit,
          include: { user: { select: { username: true } } },
        }),
      ]);

      return reply.send({
        total,
        limit,
        offset,
        entries: entries.map((e) => ({
          id: e.id,
          occurredAt: e.occurredAt,
          username: e.user?.username ?? null,
          action: e.action,
          entityType: e.entityType,
          entityId: e.entityId,
          oldValues: e.oldValues,
          newValues: e.newValues,
          ipAddress: e.ipAddress,
        })),
      });
    },
  );
}
