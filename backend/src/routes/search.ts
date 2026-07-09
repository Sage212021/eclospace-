import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/permissions.js";

const searchQuerySchema = z.object({
  q: z.string().trim().min(1),
});

// Recherche rapide de la barre supérieure (guide §6). À distinguer du moteur de
// recherche avancé de la Direction générale (/api/v1/search, Ch. 5 §5.4, réservé
// à « direction:consultation ») : ici un accès transversal, ouvert à tout profil
// pouvant consulter les ouvrages, qui retrouve un ouvrage par son titre, son
// numéro de manuscrit, le nom de son auteur (nom, prénom ou nom de plume) ou son
// ISBN. Les résultats sont allégés (aperçu cliquable) et n'exposent que ce que
// l'utilisateur a le droit de consulter : sans la permission
// « manuscripts:consultation », la recherche renvoie une liste vide, jamais une
// erreur bloquante (barre présente pour tous, résultats filtrés côté serveur).
export default async function searchRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/quick-search", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.send({ results: [] });
    }
    if (!request.user!.permissions.has("manuscripts:consultation")) {
      return reply.send({ results: [] });
    }
    const q = parsed.data.q;
    const contains = { contains: q, mode: "insensitive" as const };

    const manuscripts = await prisma.manuscript.findMany({
      where: {
        deletedAt: null,
        OR: [
          { title: contains },
          { manuscriptNumber: contains },
          {
            workContributors: {
              some: {
                partner: {
                  OR: [{ firstName: contains }, { lastName: contains }, { penName: contains }],
                },
              },
            },
          },
          { isbns: { some: { isbn13: contains } } },
        ],
      },
      include: {
        workContributors: {
          where: { role: "author" },
          orderBy: { displayOrder: "asc" },
          include: { partner: { select: { firstName: true, lastName: true, penName: true } } },
        },
        isbns: { select: { isbn13: true }, take: 1 },
      },
      take: 12,
      orderBy: { title: "asc" },
    });

    const results = manuscripts.map((m) => {
      const partner = m.workContributors[0]?.partner;
      return {
        id: m.id,
        manuscriptNumber: m.manuscriptNumber,
        title: m.title,
        author: partner ? partner.penName || `${partner.firstName} ${partner.lastName}` : null,
        isbn: m.isbns[0]?.isbn13 ?? null,
      };
    });

    return reply.send({ results });
  });
}
