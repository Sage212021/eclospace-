import type { FastifyInstance } from "fastify";
import { requireAnyRole } from "../lib/permissions.js";
import { manuscriptsDashboard } from "../lib/manuscriptsDashboard.js";
import { readingCommitteeDashboard } from "../lib/readingCommitteeDashboard.js";
import { editorialDecisionDashboard } from "../lib/editorialDecisionDashboard.js";
import { correctionDashboard } from "../lib/correctionDashboard.js";

// Tableaux de bord des sous-modules du pôle éditorial (refonte éditoriale).
// Additif : n'affecte aucun autre module de l'ERP. Réservés à la direction et
// à la tête du pôle éditorial (confidentialité du pilotage éditorial), PAR RÔLE
// — `manuscripts:consultation` étant trop large (catalogue, partagé hors pôle).
const EDITORIAL_ROLES = ["ADMIN_GENERAL", "DIR_GENERAL", "DIR_EDITORIAL", "ASSISTANT_EDITORIAL"];

export default async function editorialDashboardRoutes(fastify: FastifyInstance) {
  // Sous-module « Manuscrits » : indicateurs de flux (reçus, en évaluation,
  // en attente, taux d'acceptation, délai moyen de traitement, en retard).
  fastify.get(
    "/api/v1/editorial/manuscripts/dashboard",
    { preHandler: requireAnyRole(EDITORIAL_ROLES) },
    async (_request, reply) => {
      return reply.send(await manuscriptsDashboard());
    },
  );

  // Sous-module « Comité de lecture » : manuscrits à l'étape comité regroupés
  // par sous-état (à affecter, en lecture, rapports remis) + indicateurs
  // (rapports en attente, relecteurs actifs, en retard).
  fastify.get(
    "/api/v1/editorial/reading-committee/dashboard",
    { preHandler: requireAnyRole(EDITORIAL_ROLES) },
    async (_request, reply) => {
      return reply.send(await readingCommitteeDashboard());
    },
  );

  // Sous-module « Direction éditoriale » : manuscrits en attente de décision
  // (avec synthèse des avis de lecture et signalement des avis divergents),
  // historique des décisions actées + indicateurs (taux d'acceptation, délai
  // moyen de décision, en retard).
  fastify.get(
    "/api/v1/editorial/decisions/dashboard",
    { preHandler: requireAnyRole(EDITORIAL_ROLES) },
    async (_request, reply) => {
      return reply.send(await editorialDecisionDashboard());
    },
  );

  // Sous-module « Correction éditoriale » : manuscrits à l'étape correction
  // regroupés par sous-état (à démarrer, en cours, points bloquants, prêts à
  // valider) + indicateurs (points bloquants, en retard).
  fastify.get(
    "/api/v1/editorial/correction/dashboard",
    { preHandler: requireAnyRole(EDITORIAL_ROLES) },
    async (_request, reply) => {
      return reply.send(await correctionDashboard());
    },
  );
}
