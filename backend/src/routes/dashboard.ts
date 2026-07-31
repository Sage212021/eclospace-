import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/permissions.js";
import { editorialIndicators, commercialIndicators, revenueByFamily } from "../lib/kpi.js";

// Indicateurs de synthèse du tableau de bord (grands KPI de la page d'accueil).
// Chaque indicateur n'est calculé et renvoyé que si l'utilisateur a la
// permission de consultation correspondante — sinon il vaut null et n'est pas
// affiché (respect de la confidentialité par module).
//
// Choix : la page d'accueil, ouverte par tous à chaque connexion, s'appuie sur
// des comptages légers et sur les indicateurs déjà consolidés de `lib/kpi.ts`
// (éditorial et commercial), source unique de vérité. Les tableaux de bord
// détaillés (Direction, Rapports) restent la vue complète — cf.
// docs/JOURNAL_TECHNIQUE.md.
export default async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/dashboard/stats", { preHandler: requireAuth }, async (request, reply) => {
    const perms = request.user!.permissions;
    const canManuscripts = perms.has("manuscripts:consultation");
    const canUsers = perms.has("users:consultation");
    const canCommercial = perms.has("commercial:consultation");
    const canStock = perms.has("stock:consultation");
    const canDirection = perms.has("direction:consultation");

    const [editorial, utilisateurs, ventes, stockSum, tachesEnRetard, commercial] = await Promise.all([
      // Éditorial : total + répartition par étape (source unique lib/kpi.ts).
      canManuscripts ? editorialIndicators() : Promise.resolve(null),
      canUsers ? prisma.user.count({ where: { deletedAt: null, status: "active" } }) : Promise.resolve(null),
      canCommercial ? prisma.salesOrder.count() : Promise.resolve(null),
      canStock ? prisma.stockItem.aggregate({ _sum: { quantityPhysical: true } }) : Promise.resolve(null),
      // Tâches en retard : indicateur transverse de pilotage (Direction).
      canDirection
        ? prisma.task.count({ where: { deletedAt: null, status: { notIn: ["terminee", "validee"] }, plannedEnd: { lt: new Date() } } })
        : Promise.resolve(null),
      // Commercial : chiffre d'affaires + ruptures (une seule agrégation partagée).
      canCommercial || canStock ? commercialIndicators() : Promise.resolve(null),
    ]);

    // Ouvrages en cours = tous les ouvrages non archivés (dérivé de la frise,
    // sans requête supplémentaire).
    const ouvragesEnCours = editorial
      ? editorial.by_status.filter((s) => s.code !== "ARCHIVAGE").reduce((sum, s) => sum + s.count, 0)
      : null;

    return reply.send({
      ouvrages: editorial ? editorial.total : null,
      ouvrages_en_cours: ouvragesEnCours,
      utilisateurs,
      ventes,
      chiffre_affaires: commercial && canCommercial ? commercial.revenue_total : null,
      // Total d'exemplaires physiques en stock (somme des quantités).
      stock: stockSum ? stockSum._sum.quantityPhysical ?? 0 : null,
      ruptures: commercial && canStock ? commercial.stock_outs : null,
      taches_en_retard: tachesEnRetard,
      // Frise « pipeline éditorial » : uniquement les étapes qui portent des
      // ouvrages, dans l'ordre du workflow (lisible sur la page d'accueil).
      pipeline: editorial ? editorial.by_status.filter((s) => s.count > 0) : null,
      // Nombre total d'étapes du circuit — permet d'afficher l'avancement RÉEL
      // de chaque étape (position dans le circuit), et non un simple comptage.
      pipeline_steps_total: editorial ? Math.max(...editorial.by_status.map((s) => s.step_order), 1) : null,
    });
  });

  // Chiffre d'affaires ventilé par famille (facturé / encaissé / créances +
  // total). Donnée financière : réservée à la Finance et à la Direction.
  fastify.get("/api/v1/dashboard/revenue-by-family", { preHandler: requireAuth }, async (request, reply) => {
    const perms = request.user!.permissions;
    if (!perms.has("finance:consultation") && !perms.has("direction:consultation")) {
      return reply.code(403).send({ code: "forbidden", message: "Accès réservé à la Finance et à la Direction." });
    }
    return reply.send(await revenueByFamily());
  });
}
