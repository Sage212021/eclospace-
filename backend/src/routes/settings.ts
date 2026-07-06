import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";

// Paramétrage clé/valeur versionné (Ch. 21 §21.5 : seuils, pondérations et
// calendriers ajustables sans redéploiement). La table `settings` était
// jusqu'ici alimentée par le seed et lue par les modules métier (ISBN,
// impression, stock, dépenses, comité de lecture…), mais n'était exposée
// par aucune route : cet écran de consultation/modification manquait.
const patchSettingSchema = z.object({
  // La valeur d'un paramètre est un JSON libre (nombre, objet de seuils…).
  value: z.unknown(),
});

export default async function settingsRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/api/v1/settings",
    { preHandler: requirePermission("settings", "consultation") },
    async (_request, reply) => {
      const settings = await prisma.setting.findMany({ orderBy: { key: "asc" } });
      return reply.send(
        settings.map((s) => ({
          key: s.key,
          value: s.value,
          version: s.version,
          updatedAt: s.updatedAt,
          updatedBy: s.updatedBy,
        })),
      );
    },
  );

  fastify.patch(
    "/api/v1/settings/:key",
    { preHandler: requirePermission("settings", "administration") },
    async (request, reply) => {
      const { key } = request.params as { key: string };
      const parsed = patchSettingSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Valeur invalide.", details: parsed.error.issues });
      }

      const existing = await prisma.setting.findUnique({ where: { key } });
      if (!existing) {
        // Les paramètres sont créés par le seed : on n'autorise pas la création
        // de clés arbitraires depuis l'interface (une clé inconnue ne serait lue
        // par aucun module et resterait un réglage mort).
        return reply.code(404).send({ code: "not_found", message: `Paramètre « ${key} » inconnu.` });
      }

      const updated = await prisma.setting.update({
        where: { key },
        data: {
          value: parsed.data.value as never,
          version: { increment: 1 },
          updatedBy: request.user!.id,
        },
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "setting",
        entityId: key,
        oldValues: existing.value as never,
        newValues: updated.value as never,
        ipAddress: request.ip,
      });

      return reply.send({
        key: updated.key,
        value: updated.value,
        version: updated.version,
        updatedAt: updated.updatedAt,
        updatedBy: updated.updatedBy,
      });
    },
  );
}
