import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireAnyRole, requirePermission } from "../lib/permissions.js";

// Rôles autorisés à voir « où en est un ouvrage » : direction générale, tout le
// pôle éditorial et tout le pôle production — et eux seuls. Les autres pôles
// (commercial, finance/comptabilité, juridique, communication, RH, stock) n'y
// ont pas accès. Contrôle par rôle (et non par permission) pour cibler
// exactement ces pôles. Miroir de TRACKING_ROLES côté frontend (App.tsx).
const TRACKING_ROLES = [
  "ADMIN_GENERAL",
  "DIR_GENERAL", // Direction générale
  "DIR_EDITORIAL", // Éditorial
  "ASSISTANT_EDITORIAL",
  "MEMBRE_COMITE_LECTURE",
  "CORRECTEUR",
  "MAQUETTISTE", // Production
  "RESP_INFOGRAPHIE",
  "RESP_QUALITE",
  "RESP_IMPRESSION",
];
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
  // Réservé aux pôles éditorial et production et à la direction (cf.
  // TRACKING_ROLES) pour situer un ouvrage et renseigner un auteur — sans le
  // détail éditorial confidentiel.
  fastify.get("/api/v1/production-tracking", { preHandler: requireAnyRole(TRACKING_ROLES) }, async (_request, reply) => {
    // « Suivi des ouvrages » : vue d'ensemble de TOUT le pipeline (dès la
    // réception du manuscrit), pour que l'éditorial voie chaque ouvrage et son
    // étape d'un coup d'œil — pas seulement ceux entrés en production.
    const rows = await prisma.manuscript.findMany({
      where: { deletedAt: null },
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

  // — Administration de la grille d'évaluation (critères + coefficients) —
  // La grille sert au formulaire de notation du comité de lecture ET au rapport
  // d'évaluation IA : la modifier ici change les deux de façon cohérente.
  const criterionSchema = z.object({
    label: z.string().trim().min(1).max(160),
    coefficient: z.number().positive().max(20),
    is_active: z.boolean().optional(),
  });

  // Vue admin : TOUS les critères (actifs et inactifs), triés par poids.
  fastify.get("/api/v1/evaluation-criteria/all", { preHandler: requirePermission("manuscripts", "administration") }, async (_request, reply) => {
    const criteria = await prisma.evaluationCriterion.findMany({ orderBy: [{ isActive: "desc" }, { coefficient: "desc" }, { label: "asc" }] });
    const sum = criteria.filter((c) => c.isActive).reduce((s, c) => s + Number(c.coefficient), 0);
    return reply.send({ criteria, active_coefficient_sum: sum });
  });

  fastify.post("/api/v1/evaluation-criteria", { preHandler: requirePermission("manuscripts", "administration") }, async (request, reply) => {
    const parsed = criterionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Libellé et coefficient (> 0) requis.", details: parsed.error.issues });
    const created = await prisma.evaluationCriterion.create({ data: { label: parsed.data.label, coefficient: parsed.data.coefficient, isActive: parsed.data.is_active ?? true } });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "evaluation_criterion", entityId: created.id, newValues: { label: created.label, coefficient: Number(created.coefficient) }, ipAddress: request.ip });
    return reply.code(201).send(created);
  });

  fastify.patch("/api/v1/evaluation-criteria/:id", { preHandler: requirePermission("manuscripts", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = criterionSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const existing = await prisma.evaluationCriterion.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Critère introuvable." });
    const updated = await prisma.evaluationCriterion.update({
      where: { id },
      data: {
        ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
        ...(parsed.data.coefficient !== undefined ? { coefficient: parsed.data.coefficient } : {}),
        ...(parsed.data.is_active !== undefined ? { isActive: parsed.data.is_active } : {}),
      },
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "evaluation_criterion", entityId: id, oldValues: { label: existing.label, coefficient: Number(existing.coefficient), isActive: existing.isActive }, newValues: { label: updated.label, coefficient: Number(updated.coefficient), isActive: updated.isActive }, ipAddress: request.ip });
    return reply.send(updated);
  });

  // Retrait = désactivation (isActive=false) : on ne supprime jamais un critère
  // (des évaluations passées peuvent le référencer). Réactivable via PATCH.
  fastify.delete("/api/v1/evaluation-criteria/:id", { preHandler: requirePermission("manuscripts", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.evaluationCriterion.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Critère introuvable." });
    await prisma.evaluationCriterion.update({ where: { id }, data: { isActive: false } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "evaluation_criterion", entityId: id, oldValues: { label: existing.label, isActive: existing.isActive }, newValues: { isActive: false }, ipAddress: request.ip });
    return reply.send({ ok: true });
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
