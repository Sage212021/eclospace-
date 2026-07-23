import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";

// Saisie d'un code court normalisé (majuscules, chiffres, tiret bas) à partir
// d'un libellé, si l'opérateur n'en fournit pas.
function slugCode(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

const referenceItemSchema = z.object({
  label: z.string().min(1),
  code: z.string().min(1).max(40).optional(),
});

// Listes déroulantes du dossier éditorial (Ch. 6 §6.2) — données de référence
// non sensibles, ouvertes en lecture à tout utilisateur authentifié. Leur
// gestion (ajout/retrait) est réservée au niveau administration du module
// manuscrits (secrétariat éditorial : « à compléter selon le catalogue réel »).
export default async function referenceRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/genres", { preHandler: requireAuth }, async (_request, reply) => {
    const genres = await prisma.genre.findMany({ where: { deletedAt: null }, orderBy: { label: "asc" } });
    return reply.send(genres);
  });

  fastify.get("/api/v1/collections", { preHandler: requireAuth }, async (_request, reply) => {
    const collections = await prisma.collection.findMany({ where: { deletedAt: null }, orderBy: { label: "asc" } });
    return reply.send(collections);
  });

  // Étapes du circuit d'un ouvrage, dans l'ordre — pour afficher la frise de
  // progression (« où en est l'ouvrage ») accessible à tout le personnel.
  fastify.get("/api/v1/workflow-statuses", { preHandler: requireAuth }, async (_request, reply) => {
    const statuses = await prisma.workflowStatus.findMany({
      orderBy: { stepOrder: "asc" },
      select: { code: true, label: true, stepOrder: true, isConditional: true },
    });
    return reply.send(statuses);
  });

  // Suivi de production : les ouvrages engagés dans un projet de publication
  // (acceptés, à partir de la contractualisation), avec leur étape courante.
  // Accessible à tout le personnel (commercial, assistanat…) pour situer un
  // ouvrage et renseigner un auteur — sans le détail éditorial confidentiel.
  fastify.get("/api/v1/production-tracking", { preHandler: requireAuth }, async (_request, reply) => {
    const rows = await prisma.manuscript.findMany({
      where: { deletedAt: null, status: { stepOrder: { gte: 5 } } },
      select: {
        id: true,
        title: true,
        manuscriptNumber: true,
        publicationDate: true,
        status: { select: { code: true, label: true, stepOrder: true } },
        workContributors: {
          where: { role: "author" },
          orderBy: { displayOrder: "asc" },
          take: 1,
          select: { partner: { select: { firstName: true, lastName: true, penName: true } } },
        },
      },
      orderBy: [{ status: { stepOrder: "desc" } }, { title: "asc" }],
    });
    return reply.send(
      rows.map((m) => {
        const p = m.workContributors[0]?.partner;
        return {
          id: m.id,
          title: m.title,
          manuscriptNumber: m.manuscriptNumber,
          author: p ? (p.penName ?? `${p.firstName} ${p.lastName}`) : null,
          statusCode: m.status.code,
          statusLabel: m.status.label,
          stepOrder: m.status.stepOrder,
        };
      }),
    );
  });

  // Grille d'évaluation du comité de lecture (Ch. 7 §7.4) — nécessaire au
  // formulaire de notation pour savoir quels critères noter.
  fastify.get("/api/v1/evaluation-criteria", { preHandler: requireAuth }, async (_request, reply) => {
    const criteria = await prisma.evaluationCriterion.findMany({ where: { isActive: true }, orderBy: { label: "asc" } });
    return reply.send(criteria);
  });

  // --- Gestion des domaines (genres) et collections (spéc. fonctionnelle §6) ---

  fastify.post("/api/v1/genres", { preHandler: requirePermission("manuscripts", "administration") }, async (request, reply) => {
    const parsed = referenceItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Libellé requis.", details: parsed.error.issues });
    }
    const code = (parsed.data.code ?? slugCode(parsed.data.label)) || "DOMAINE";
    const existing = await prisma.genre.findUnique({ where: { code } });
    if (existing && !existing.deletedAt) {
      return reply.code(409).send({ code: "code_taken", message: `Un domaine avec le code « ${code} » existe déjà.` });
    }
    // Réactive un domaine précédemment retiré plutôt que d'en dupliquer le code.
    const genre = existing
      ? await prisma.genre.update({ where: { id: existing.id }, data: { label: parsed.data.label, deletedAt: null } })
      : await prisma.genre.create({ data: { code, label: parsed.data.label } });
    await writeAuditLog({
      userId: request.user!.id,
      action: existing ? "update" : "create",
      entityType: "genre",
      entityId: genre.id,
      newValues: { code: genre.code, label: genre.label },
      ipAddress: request.ip,
    });
    return reply.code(201).send(genre);
  });

  fastify.delete("/api/v1/genres/:id", { preHandler: requirePermission("manuscripts", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const genre = await prisma.genre.findFirst({ where: { id, deletedAt: null } });
    if (!genre) {
      return reply.code(404).send({ code: "not_found", message: "Domaine introuvable." });
    }
    const inUse = await prisma.manuscript.count({ where: { genreId: id, deletedAt: null } });
    if (inUse > 0) {
      return reply.code(409).send({
        code: "reference_in_use",
        message: `Ce domaine est utilisé par ${inUse} ouvrage(s) ; il ne peut pas être retiré.`,
      });
    }
    await prisma.genre.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "genre",
      entityId: id,
      oldValues: { code: genre.code, label: genre.label },
      newValues: { removed: true },
      ipAddress: request.ip,
    });
    return reply.send({ ok: true });
  });

  fastify.post("/api/v1/collections", { preHandler: requirePermission("manuscripts", "administration") }, async (request, reply) => {
    const parsed = referenceItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Libellé requis.", details: parsed.error.issues });
    }
    const code = (parsed.data.code ?? slugCode(parsed.data.label)) || "COLLECTION";
    const existing = await prisma.collection.findUnique({ where: { code } });
    if (existing && !existing.deletedAt) {
      return reply.code(409).send({ code: "code_taken", message: `Une collection avec le code « ${code} » existe déjà.` });
    }
    const collection = existing
      ? await prisma.collection.update({ where: { id: existing.id }, data: { label: parsed.data.label, deletedAt: null } })
      : await prisma.collection.create({ data: { code, label: parsed.data.label } });
    await writeAuditLog({
      userId: request.user!.id,
      action: existing ? "update" : "create",
      entityType: "collection",
      entityId: collection.id,
      newValues: { code: collection.code, label: collection.label },
      ipAddress: request.ip,
    });
    return reply.code(201).send(collection);
  });

  fastify.delete("/api/v1/collections/:id", { preHandler: requirePermission("manuscripts", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const collection = await prisma.collection.findFirst({ where: { id, deletedAt: null } });
    if (!collection) {
      return reply.code(404).send({ code: "not_found", message: "Collection introuvable." });
    }
    const inUse = await prisma.manuscript.count({ where: { collectionId: id, deletedAt: null } });
    if (inUse > 0) {
      return reply.code(409).send({
        code: "reference_in_use",
        message: `Cette collection est utilisée par ${inUse} ouvrage(s) ; elle ne peut pas être retirée.`,
      });
    }
    await prisma.collection.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "collection",
      entityId: id,
      oldValues: { code: collection.code, label: collection.label },
      newValues: { removed: true },
      ipAddress: request.ip,
    });
    return reply.send({ ok: true });
  });
}
