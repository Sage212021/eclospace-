import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/permissions.js";

// Indicateurs de synthèse du tableau de bord (grands KPI de la page d'accueil).
// Chaque indicateur n'est calculé et renvoyé que si l'utilisateur a la
// permission de consultation correspondante — sinon il vaut null et n'est pas
// affiché (respect de la confidentialité par module).
export default async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/dashboard/stats", { preHandler: requireAuth }, async (request, reply) => {
    const perms = request.user!.permissions;

    const [ouvrages, utilisateurs, ventes, stockSum] = await Promise.all([
      perms.has("manuscripts:consultation") ? prisma.manuscript.count({ where: { deletedAt: null } }) : Promise.resolve(null),
      perms.has("users:consultation") ? prisma.user.count({ where: { deletedAt: null, status: "active" } }) : Promise.resolve(null),
      perms.has("commercial:consultation") ? prisma.salesOrder.count() : Promise.resolve(null),
      perms.has("stock:consultation")
        ? prisma.stockItem.aggregate({ _sum: { quantityPhysical: true } })
        : Promise.resolve(null),
    ]);

    return reply.send({
      ouvrages,
      utilisateurs,
      ventes,
      // Total d'exemplaires physiques en stock (somme des quantités).
      stock: stockSum ? stockSum._sum.quantityPhysical ?? 0 : null,
    });
  });
}
