import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/permissions.js";
import { editorialIndicators, commercialIndicators, revenueByFamily, annualSummary } from "../lib/kpi.js";

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
// Confidentialité des indicateurs éditoriaux de la page d'accueil (nombre
// d'ouvrages, pipeline « où en sont les ouvrages ») : ce sont des informations
// de pilotage ÉDITORIAL. `manuscripts:consultation` est trop large (accès
// catalogue, partagé par le juridique, la production, le contrôle qualité…) :
// on réserve donc ces indicateurs à la direction et à la tête du pôle éditorial,
// PAR RÔLE. Les autres profils gardent leurs propres indicateurs (finance,
// stock, utilisateurs…). Correctif du 05/08/2026.
const EDITORIAL_VIEW_ROLES = ["ADMIN_GENERAL", "DIR_GENERAL", "DIR_EDITORIAL", "ASSISTANT_EDITORIAL"];

// Chiffre d'affaires PROPRE d'un commercial : ses ventes au comptoir (soldBy) +
// ses commandes (createdBy), remise déduite. Sert à n'exposer, sur la page
// d'accueil d'un commercial simple, que le CA lié à SES ventes enregistrées.
async function ownCommercialRevenue(userId: string): Promise<number> {
  const [posSales, orders] = await Promise.all([
    prisma.posSale.findMany({ where: { soldBy: userId }, select: { quantity: true, unitPrice: true } }),
    prisma.salesOrder.findMany({ where: { createdBy: userId }, select: { lines: { select: { quantity: true, unitPrice: true, discountPct: true } } } }),
  ]);
  const pos = posSales.reduce((s, p) => s + p.quantity * Number(p.unitPrice), 0);
  const ord = orders.reduce((s, o) => s + o.lines.reduce((ls, l) => ls + l.quantity * Number(l.unitPrice) * (1 - Number(l.discountPct) / 100), 0), 0);
  return Math.round(pos + ord);
}

// CA TOTAL de l'équipe commerciale : toutes les ventes comptoir + toutes les
// commandes (remise déduite), quel que soit le vendeur. C'est le même total que
// la ligne « TOTAL ÉQUIPE » de « Performance par commercial ».
async function teamCommercialRevenue(): Promise<number> {
  const [posSales, orders] = await Promise.all([
    prisma.posSale.findMany({ select: { quantity: true, unitPrice: true } }),
    prisma.salesOrder.findMany({ select: { lines: { select: { quantity: true, unitPrice: true, discountPct: true } } } }),
  ]);
  const pos = posSales.reduce((s, p) => s + p.quantity * Number(p.unitPrice), 0);
  const ord = orders.reduce((s, o) => s + o.lines.reduce((ls, l) => ls + l.quantity * Number(l.unitPrice) * (1 - Number(l.discountPct) / 100), 0), 0);
  return Math.round(pos + ord);
}

export default async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/dashboard/stats", { preHandler: requireAuth }, async (request, reply) => {
    const perms = request.user!.permissions;
    const canEditorialView = request.user!.roles.some((r) => EDITORIAL_VIEW_ROLES.includes(r));
    const canUsers = perms.has("users:consultation");
    const canCommercial = perms.has("commercial:consultation");
    const canStock = perms.has("stock:consultation");
    const canDirection = perms.has("direction:consultation");
    // Trois niveaux de lecture du « chiffre d'affaires » sur l'accueil :
    //  - company : CA GLOBAL de l'entreprise (DG, Finance, Administrateur) ;
    //  - team    : total des ventes de TOUS les commerciaux (responsable commercial) ;
    //  - own     : uniquement les ventes du commercial connecté (commercial simple).
    const canSeeCompanyRevenue = canDirection || perms.has("finance:consultation");
    const canSeeTeamRevenue = !canSeeCompanyRevenue && (perms.has("commercial:validation") || perms.has("commercial:administration"));
    const isPlainCommercial = canCommercial && !canSeeCompanyRevenue && !canSeeTeamRevenue;

    const [editorial, utilisateurs, ventes, stockSum, tachesEnRetard, commercial, ownRevenue, teamRevenue] = await Promise.all([
      // Éditorial : total + répartition par étape (source unique lib/kpi.ts).
      // Réservé aux rôles éditorial/direction (indicateurs de pilotage).
      canEditorialView ? editorialIndicators() : Promise.resolve(null),
      canUsers ? prisma.user.count({ where: { deletedAt: null, status: "active" } }) : Promise.resolve(null),
      canCommercial ? prisma.salesOrder.count() : Promise.resolve(null),
      canStock ? prisma.stockItem.aggregate({ _sum: { quantityPhysical: true } }) : Promise.resolve(null),
      // Tâches en retard : indicateur transverse de pilotage (Direction).
      canDirection
        ? prisma.task.count({ where: { deletedAt: null, status: { notIn: ["terminee", "validee"] }, plannedEnd: { lt: new Date() } } })
        : Promise.resolve(null),
      // Commercial : chiffre d'affaires GLOBAL + ruptures (agrégation partagée),
      // seulement si l'utilisateur a le droit de voir les chiffres d'entreprise.
      canSeeCompanyRevenue || canStock ? commercialIndicators() : Promise.resolve(null),
      // CA PROPRE d'un commercial simple : ses ventes comptoir + ses commandes.
      isPlainCommercial ? ownCommercialRevenue(request.user!.id) : Promise.resolve(null),
      // CA TOTAL de l'équipe commerciale (tous les commerciaux) : pour le responsable.
      canSeeTeamRevenue ? teamCommercialRevenue() : Promise.resolve(null),
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
      chiffre_affaires: canSeeCompanyRevenue ? (commercial ? commercial.revenue_total : null) : canSeeTeamRevenue ? teamRevenue : isPlainCommercial ? ownRevenue : null,
      // "company" = CA global entreprise ; "team" = total de tous les commerciaux ;
      // "own" = les ventes du commercial connecté.
      chiffre_affaires_scope: canSeeCompanyRevenue ? "company" : canSeeTeamRevenue ? "team" : isPlainCommercial ? "own" : null,
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

  // Bilan par année : chaque grand indicateur décliné par année, plus le
  // mouvement global (tendance annuelle + cumul tout-temps). Vue de pilotage —
  // réservée à la Finance et à la Direction.
  fastify.get<{ Querystring: { year?: string } }>(
    "/api/v1/dashboard/annual-summary",
    { preHandler: requireAuth },
    async (request, reply) => {
      const perms = request.user!.permissions;
      if (!perms.has("finance:consultation") && !perms.has("direction:consultation")) {
        return reply.code(403).send({ code: "forbidden", message: "Accès réservé à la Finance et à la Direction." });
      }
      const raw = request.query.year;
      const parsed = raw ? Number(raw) : undefined;
      const year = parsed && Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
      return reply.send(await annualSummary(year));
    },
  );
}
