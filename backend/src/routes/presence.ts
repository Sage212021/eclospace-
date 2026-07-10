import type { FastifyInstance } from "fastify";
import { requireAuth } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";
import { writeAuditLog } from "../lib/audit.js";
import { getPresenceNamesByDepartment } from "../lib/presence.js";

// Rôle désignant le responsable d'un département (décision opérateur du
// 10/07/2026 : « le responsable d'un pôle sera désigné : Chef de département »).
const CHEF_ROLE = "CHEF_DEPARTEMENT";

// Révélation habilitée des personnes présentes (exigence de confidentialité du
// 09/07/2026). Le canal temps réel ne diffuse que des compteurs ; ici, et ici
// seulement, les NOMS sont exposés — et selon un périmètre strict :
//   • Direction générale (permission « direction:consultation ») et
//     super-administrateur (qui détient toutes les permissions) : TOUS les
//     départements ;
//   • Chef de département (rôle CHEF_DEPARTEMENT) : UNIQUEMENT son propre
//     département (celui de sa fiche employé) ;
//   • tout autre profil : 403, refus lui-même journalisé (« access_denied »).
export default async function presenceRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/presence/names", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;
    const isOversight = user.permissions.has("direction:consultation");
    const isChef = user.roles.includes(CHEF_ROLE);

    if (!isOversight && !isChef) {
      void writeAuditLog({
        userId: user.id,
        action: "access_denied",
        entityType: "presence",
        entityId: "presence:names",
        newValues: { method: request.method, url: request.url },
        ipAddress: request.ip,
      }).catch(() => {});
      return reply.code(403).send({
        code: "forbidden",
        message: "Révélation des identités réservée à la Direction générale et aux chefs de département.",
      });
    }

    // Oversight : tous les départements. Chef : borné à son propre département.
    if (isOversight) {
      return reply.send(getPresenceNamesByDepartment());
    }

    const employee = await prisma.user
      .findUnique({ where: { id: user.id }, include: { employee: true } })
      .then((u) => u?.employee ?? null);
    const departmentId = employee?.departmentId ?? null;
    if (!departmentId) {
      // Chef sans département rattaché : rien à révéler légitimement (refus tracé).
      void writeAuditLog({
        userId: user.id,
        action: "access_denied",
        entityType: "presence",
        entityId: "presence:names",
        newValues: { reason: "chef_sans_departement" },
        ipAddress: request.ip,
      }).catch(() => {});
      return reply.code(403).send({
        code: "forbidden",
        message: "Aucun département n'est rattaché à votre fiche : révélation impossible.",
      });
    }
    return reply.send(getPresenceNamesByDepartment(departmentId));
  });
}
