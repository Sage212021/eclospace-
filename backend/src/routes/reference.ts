import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/permissions.js";

// Listes déroulantes du dossier éditorial (Ch. 6 §6.2) — données de référence
// non sensibles, ouvertes à tout utilisateur authentifié.
export default async function referenceRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/genres", { preHandler: requireAuth }, async (_request, reply) => {
    const genres = await prisma.genre.findMany({ where: { deletedAt: null }, orderBy: { label: "asc" } });
    return reply.send(genres);
  });

  fastify.get("/api/v1/collections", { preHandler: requireAuth }, async (_request, reply) => {
    const collections = await prisma.collection.findMany({ where: { deletedAt: null }, orderBy: { label: "asc" } });
    return reply.send(collections);
  });

  // Grille d'évaluation du comité de lecture (Ch. 7 §7.4) — nécessaire au
  // formulaire de notation pour savoir quels critères noter.
  fastify.get("/api/v1/evaluation-criteria", { preHandler: requireAuth }, async (_request, reply) => {
    const criteria = await prisma.evaluationCriterion.findMany({ where: { isActive: true }, orderBy: { label: "asc" } });
    return reply.send(criteria);
  });
}
