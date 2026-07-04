import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";

// Liste minimale des comptes actifs — nécessaire pour les sélecteurs
// "responsable du dossier" / "lecteur affecté" (Ch. 6 §6.2, Ch. 7 §7.2).
// La gestion complète des comptes (création, désactivation) est le Lot 6.
export default async function userRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/users", { preHandler: requirePermission("users", "consultation") }, async (_request, reply) => {
    const users = await prisma.user.findMany({
      where: { deletedAt: null, status: "active" },
      select: { id: true, username: true, email: true },
      orderBy: { username: "asc" },
    });
    return reply.send(users);
  });
}
