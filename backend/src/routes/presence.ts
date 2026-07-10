import type { FastifyInstance } from "fastify";
import { requirePermission } from "../lib/permissions.js";
import { getPresenceNamesByPole } from "../lib/presence.js";

// Révélation habilitée des personnes présentes (exigence de confidentialité du
// 09/07/2026). Le canal temps réel ne diffuse que des compteurs ; ici, et ici
// seulement, les NOMS sont exposés — et uniquement à un profil d'oversight.
//
// Le garde « direction:consultation » cible exactement les profils voulus : la
// Direction générale (qui détient cette permission) et le super-administrateur
// (qui détient toutes les permissions). Tout autre profil reçoit 403 — refus
// lui-même journalisé (action « access_denied »), comme toute tentative d'accès
// non autorisée. La révélation par « responsable de son propre pôle » n'est pas
// encore ouverte : elle suppose de désigner formellement le responsable d'un
// pôle, décision de structuration à acter avec l'opérateur (règle 2, CLAUDE.md).
export default async function presenceRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/api/v1/presence/names",
    { preHandler: requirePermission("direction", "consultation") },
    async (_request, reply) => {
      return reply.send(getPresenceNamesByPole());
    },
  );
}
