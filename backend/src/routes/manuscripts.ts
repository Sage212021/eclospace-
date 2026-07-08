import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ManuscriptOrigin } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { nextManuscriptNumber } from "../lib/manuscriptNumber.js";

const authorSchema = z.union([
  z.object({ author_id: z.string().uuid() }),
  z.object({ first_name: z.string().min(1), last_name: z.string().min(1), pen_name: z.string().optional() }),
]);

const createManuscriptSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  collection_id: z.string().uuid().optional(),
  genre_id: z.string().uuid(),
  language: z.string().min(2),
  estimated_pages: z.number().int().positive().optional(),
  summary: z.string().optional(),
  keywords: z.array(z.string()).default([]),
  origin: z.nativeEnum(ManuscriptOrigin).default("soumission"),
  owner_id: z.string().uuid(),
  author: authorSchema,
});

const patchManuscriptSchema = z.object({
  title: z.string().min(1).optional(),
  subtitle: z.string().optional(),
  collection_id: z.string().uuid().optional(),
  genre_id: z.string().uuid().optional(),
  language: z.string().min(2).optional(),
  estimated_pages: z.number().int().positive().optional(),
  summary: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  owner_id: z.string().uuid().optional(),
  project_manager_id: z.string().uuid().optional(),
  requires_expertise: z.boolean().optional(),
  requires_rewrite: z.boolean().optional(),
});

const priorityOverrideSchema = z.object({
  score: z.number(),
  justification: z.string().min(1),
});

// Import d'un ouvrage déjà paru (spéc. fonctionnelle §8) : on saisit son état
// actuel, dont sa date de parution historique — pas un manuscrit qui démarre
// le circuit.
const importManuscriptSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  collection_id: z.string().uuid().optional(),
  genre_id: z.string().uuid(),
  language: z.string().min(2),
  estimated_pages: z.number().int().positive().optional(),
  summary: z.string().optional(),
  keywords: z.array(z.string()).default([]),
  owner_id: z.string().uuid(),
  author: authorSchema,
  publication_date: z.coerce.date(),
});

// Antidatage de la date de parution (spéc. fonctionnelle §8) : renseigner
// après coup la date réelle de parution d'un ouvrage, avec conservation de la
// date de saisie effective au journal (§9).
const publicationDateSchema = z.object({
  publication_date: z.coerce.date(),
  note: z.string().optional(),
});

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const listQuerySchema = z.object({
  status: z.string().optional(),
  collection: z.string().uuid().optional(),
  priority_min: z.coerce.number().optional(),
  sort: z.enum(["priority", "received_at"]).optional(),
});

// Secrétariat éditorial (Ch. 6) : point d'entrée unique de tout manuscrit.
export default async function manuscriptRoutes(fastify: FastifyInstance) {
  fastify.post("/api/v1/manuscripts", { preHandler: requirePermission("manuscripts", "saisie") }, async (request, reply) => {
    const parsed = createManuscriptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const body = parsed.data;

    const receptionStatus = await prisma.workflowStatus.findUnique({ where: { code: "RECEPTION" } });
    if (!receptionStatus) {
      return reply.code(500).send({ code: "referential_missing", message: "Statut RECEPTION absent du référentiel (seed manquant)." });
    }
    // L'étape 1 est validée dès la création (voir plus bas) : le manuscrit
    // entre donc directement à l'étape 2 (Ch. 4 §4.3).
    const verificationStatus = await prisma.workflowStatus.findFirstOrThrow({
      where: { stepOrder: receptionStatus.stepOrder + 1 },
    });

    const manuscriptNumber = await nextManuscriptNumber();
    const now = new Date();

    const manuscript = await prisma.$transaction(async (tx) => {
      // L'auteur est un partenaire de catégorie « auteur » (fiche unique
      // couvrant aussi correcteurs, traducteurs, imprimeurs... — décision
      // opérateur du 04/07/2026, voir docs/JOURNAL_TECHNIQUE.md).
      const author =
        "author_id" in body.author
          ? await tx.partner.findUniqueOrThrow({ where: { id: body.author.author_id } })
          : await tx.partner.create({
              data: {
                category: "auteur",
                firstName: body.author.first_name,
                lastName: body.author.last_name,
                penName: body.author.pen_name,
                createdBy: request.user!.id,
                updatedBy: request.user!.id,
              },
            });

      const created = await tx.manuscript.create({
        data: {
          manuscriptNumber,
          title: body.title,
          subtitle: body.subtitle,
          collectionId: body.collection_id,
          genreId: body.genre_id,
          language: body.language,
          estimatedPages: body.estimated_pages,
          summary: body.summary,
          keywords: body.keywords,
          origin: body.origin,
          statusId: verificationStatus.id,
          ownerId: body.owner_id,
          receivedAt: now,
          createdBy: request.user!.id,
          updatedBy: request.user!.id,
          workContributors: {
            create: { partnerId: author.id, role: "author", displayOrder: 0 },
          },
        },
      });

      // Étape 1 — Réception (Ch. 4 §4.3) : l'enregistrement du dossier
      // constitue lui-même la validation de cette première étape.
      await tx.manuscriptStep.create({
        data: {
          manuscriptId: created.id,
          statusId: receptionStatus.id,
          responsibleId: body.owner_id,
          actualStart: now,
          actualEnd: now,
          validationBy: request.user!.id,
          validatedAt: now,
        },
      });
      await tx.stepTransition.create({
        data: {
          manuscriptId: created.id,
          toStatusCode: receptionStatus.code,
          toDepartmentId: receptionStatus.departmentId,
          responsibleId: request.user!.id,
        },
      });
      await tx.stepTransition.create({
        data: {
          manuscriptId: created.id,
          fromStatusCode: receptionStatus.code,
          toStatusCode: verificationStatus.code,
          fromDepartmentId: receptionStatus.departmentId,
          toDepartmentId: verificationStatus.departmentId,
          responsibleId: request.user!.id,
        },
      });

      return created;
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "manuscript",
      entityId: manuscript.id,
      newValues: { manuscriptNumber, title: body.title },
      ipAddress: request.ip,
    });

    return reply.code(201).send(manuscript);
  });

  // Import d'un ouvrage déjà paru (spéc. fonctionnelle §8) : entrée directe
  // dans le catalogue avec sa date de parution historique, sans dérouler le
  // circuit de production. Le suivi post-publication devient son étape courante.
  fastify.post("/api/v1/manuscripts/import", { preHandler: requirePermission("manuscripts", "saisie") }, async (request, reply) => {
    const parsed = importManuscriptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const body = parsed.data;

    if (body.publication_date > startOfToday()) {
      return reply.code(400).send({
        code: "future_publication_date",
        message: "La date de parution d'un ouvrage déjà paru ne peut pas être postérieure à aujourd'hui.",
      });
    }

    const publishedStatus = await prisma.workflowStatus.findUnique({ where: { code: "SUIVI_POST_PUBLICATION" } });
    if (!publishedStatus) {
      return reply.code(500).send({ code: "referential_missing", message: "Statut SUIVI_POST_PUBLICATION absent du référentiel (seed manquant)." });
    }

    const manuscriptNumber = await nextManuscriptNumber();
    const recordedAt = new Date();

    const manuscript = await prisma.$transaction(async (tx) => {
      const author =
        "author_id" in body.author
          ? await tx.partner.findUniqueOrThrow({ where: { id: body.author.author_id } })
          : await tx.partner.create({
              data: {
                category: "auteur",
                firstName: body.author.first_name,
                lastName: body.author.last_name,
                penName: body.author.pen_name,
                createdBy: request.user!.id,
                updatedBy: request.user!.id,
              },
            });

      return tx.manuscript.create({
        data: {
          manuscriptNumber,
          title: body.title,
          subtitle: body.subtitle,
          collectionId: body.collection_id,
          genreId: body.genre_id,
          language: body.language,
          estimatedPages: body.estimated_pages,
          summary: body.summary,
          keywords: body.keywords,
          origin: "soumission",
          statusId: publishedStatus.id,
          ownerId: body.owner_id,
          // Un ouvrage déjà paru n'a pas de « date de réception » : on aligne
          // sur sa parution pour rester cohérent dans les listes.
          receivedAt: body.publication_date,
          publicationDate: body.publication_date,
          isBackCatalogue: true,
          createdBy: request.user!.id,
          updatedBy: request.user!.id,
          workContributors: { create: { partnerId: author.id, role: "author", displayOrder: 0 } },
        },
      });
    });

    // Traçabilité (§9) : on conserve la date de parution historique ET la date
    // de saisie effective, pour distinguer l'antidatage d'une saisie au fil de l'eau.
    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "manuscript",
      entityId: manuscript.id,
      newValues: {
        manuscriptNumber,
        title: body.title,
        imported: true,
        back_catalogue: true,
        publication_date: body.publication_date.toISOString(),
        recorded_at: recordedAt.toISOString(),
        antidated: body.publication_date < startOfToday(),
      },
      ipAddress: request.ip,
    });

    return reply.code(201).send(manuscript);
  });

  fastify.get("/api/v1/manuscripts", { preHandler: requirePermission("manuscripts", "consultation") }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Paramètres invalides.", details: parsed.error.issues });
    }
    const { status, collection, priority_min, sort } = parsed.data;

    const manuscripts = await prisma.manuscript.findMany({
      where: {
        deletedAt: null,
        ...(status ? { status: { code: status } } : {}),
        ...(collection ? { collectionId: collection } : {}),
        ...(priority_min !== undefined ? { priorityScore: { gte: priority_min } } : {}),
      },
      include: { status: true, genre: true, collection: true },
      orderBy: sort === "priority" ? { priorityScore: "desc" } : { receivedAt: "desc" },
    });
    return reply.send(manuscripts);
  });

  fastify.get("/api/v1/manuscripts/:id", { preHandler: requirePermission("manuscripts", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const manuscript = await prisma.manuscript.findFirst({
      where: { id, deletedAt: null },
      include: {
        status: true,
        genre: true,
        collection: true,
        owner: { select: { id: true, username: true } },
        projectManager: { select: { id: true, username: true } },
        workContributors: { include: { partner: true } },
        steps: { include: { status: true }, orderBy: { status: { stepOrder: "asc" } } },
      },
    });
    if (!manuscript) {
      return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
    }
    return reply.send(manuscript);
  });

  fastify.patch("/api/v1/manuscripts/:id", { preHandler: requirePermission("manuscripts", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = patchManuscriptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }

    const existing = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
    if (!existing) {
      return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
    }

    const body = parsed.data;
    const updated = await prisma.manuscript.update({
      where: { id },
      data: {
        title: body.title,
        subtitle: body.subtitle,
        collectionId: body.collection_id,
        genreId: body.genre_id,
        language: body.language,
        estimatedPages: body.estimated_pages,
        summary: body.summary,
        keywords: body.keywords,
        ownerId: body.owner_id,
        projectManagerId: body.project_manager_id,
        requiresExpertise: body.requires_expertise,
        requiresRewrite: body.requires_rewrite,
        updatedBy: request.user!.id,
      },
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "manuscript",
      entityId: id,
      oldValues: JSON.parse(JSON.stringify(existing)),
      newValues: body,
      ipAddress: request.ip,
    });

    return reply.send(updated);
  });

  // Frise chronologique (Ch. 4 §4.4).
  fastify.get(
    "/api/v1/manuscripts/:id/timeline",
    { preHandler: requirePermission("manuscripts", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }

      const allStatuses = await prisma.workflowStatus.findMany({ orderBy: { stepOrder: "asc" } });
      const steps = await prisma.manuscriptStep.findMany({ where: { manuscriptId: id } });
      const stepByStatusId = new Map(steps.map((step) => [step.statusId, step]));

      const timeline = allStatuses.map((status) => {
        const step = stepByStatusId.get(status.id);
        return {
          status_code: status.code,
          label: status.label,
          step_order: status.stepOrder,
          is_conditional: status.isConditional,
          validated_at: step?.validatedAt ?? null,
          planned_end: step?.plannedEnd ?? null,
          actual_end: step?.actualEnd ?? null,
          late: Boolean(step?.plannedEnd && step.actualEnd && step.actualEnd > step.plannedEnd),
        };
      });

      return reply.send(timeline);
    },
  );

  // Ajustement manuel de la priorité par la Direction éditoriale (Ch. 6 §6.5) — tracé.
  fastify.post(
    "/api/v1/manuscripts/:id/priority-override",
    { preHandler: requirePermission("manuscripts", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = priorityOverrideSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const existing = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!existing) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }

      const updated = await prisma.manuscript.update({
        where: { id },
        data: {
          priorityOverride: parsed.data.score,
          priorityOverrideJustification: parsed.data.justification,
          updatedBy: request.user!.id,
        },
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "manuscript",
        entityId: id,
        oldValues: { priorityOverride: existing.priorityOverride },
        newValues: parsed.data,
        ipAddress: request.ip,
      });

      return reply.send(updated);
    },
  );

  // Date de parution / antidatage (spéc. fonctionnelle §8) : renseigner ou
  // corriger la date réelle de parution d'un ouvrage. Le journal conserve la
  // date de saisie effective et signale l'antidatage (date antérieure à ce jour).
  fastify.post(
    "/api/v1/manuscripts/:id/publication-date",
    { preHandler: requirePermission("manuscripts", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = publicationDateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Date invalide.", details: parsed.error.issues });
      }

      const existing = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!existing) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }

      const recordedAt = new Date();
      const updated = await prisma.manuscript.update({
        where: { id },
        data: { publicationDate: parsed.data.publication_date, updatedBy: request.user!.id },
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "manuscript",
        entityId: id,
        oldValues: { publication_date: existing.publicationDate?.toISOString() ?? null },
        newValues: {
          change: "publication_date",
          publication_date: parsed.data.publication_date.toISOString(),
          recorded_at: recordedAt.toISOString(),
          antidated: parsed.data.publication_date < startOfToday(),
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
        },
        ipAddress: request.ip,
      });

      return reply.send(updated);
    },
  );
}
