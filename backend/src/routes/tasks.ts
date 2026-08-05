import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TaskType, TaskPriority, TaskStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission, requireAuth } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { storeFile, readStoredFile } from "../lib/storage.js";

// Tâches relevant de la correction éditoriale (Ch. 10 §10.3) et titre réservé
// au dépôt de la version corrigée (sortie du correcteur → entrée de la Maquette).
const CORRECTION_TASK_TYPES: TaskType[] = [
  "correction_ortho",
  "correction_gramm",
  "correction_typo",
  "correction_syntaxe",
  "correction_style",
  "harmonisation",
  "verif_biblio",
  "coherence",
];
const CORRECTED_DOC_TITLE = "Manuscrit corrigé";

const createTaskSchema = z.object({
  title: z.string().min(1),
  type: z.nativeEnum(TaskType),
  step_id: z.string().uuid().optional(),
  assignee_id: z.string().uuid().optional(),
  priority: z.nativeEnum(TaskPriority).default("medium"),
  planned_start: z.coerce.date().optional(),
  planned_end: z.coerce.date().optional(),
  depends_on_task_id: z.string().uuid().optional(),
});

const patchTaskSchema = z.object({
  progress_pct: z.number().int().min(0).max(100).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  planned_end: z.coerce.date().optional(),
});

const rescheduleSchema = z.object({
  planned_start: z.coerce.date().optional(),
  planned_end: z.coerce.date().optional(),
  justification: z.string().min(1),
});

const listTasksQuerySchema = z.object({
  assignee: z.string().optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  manuscript: z.string().uuid().optional(),
});

const ganttQuerySchema = z.object({
  view: z.enum(["portfolio"]).default("portfolio"),
  collection: z.string().uuid().optional(),
  manager: z.string().uuid().optional(),
});

// Statuts indiquant qu'une tâche est déjà engagée : un déplacement d'échéance
// dessus est un conflit à signaler (Ch. 8 §8.7).
const ENGAGED_STATUSES: TaskStatus[] = ["en_cours", "terminee", "validee"];

// Tâches et diagramme de Gantt (Ch. 8 §8.4-8.12) ; les mêmes tâches portent
// aussi les missions de correction du Ch. 10 §10.2-10.3 (modèle §4.5).
export default async function taskRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/api/v1/manuscripts/:id/tasks",
    { preHandler: requirePermission("tasks", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = createTaskSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }

      const body = parsed.data;
      const task = await prisma.task.create({
        data: {
          manuscriptId: id,
          stepId: body.step_id,
          title: body.title,
          type: body.type,
          assigneeId: body.assignee_id,
          priority: body.priority,
          plannedStart: body.planned_start,
          plannedEnd: body.planned_end,
          dependsOnTaskId: body.depends_on_task_id,
          createdBy: request.user!.id,
          updatedBy: request.user!.id,
        },
      });

      if (body.assignee_id) {
        await prisma.notification.create({
          data: {
            userId: body.assignee_id,
            type: "affectation",
            priority: "medium",
            title: "Nouvelle tâche assignée",
            body: `« ${body.title} » sur le manuscrit ${manuscript.manuscriptNumber}.`,
            entityType: "task",
            entityId: task.id,
          },
        });
      }

      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "task",
        entityId: task.id,
        newValues: { manuscriptId: id, title: body.title, type: body.type },
        ipAddress: request.ip,
      });

      return reply.code(201).send(task);
    },
  );

  fastify.get("/api/v1/tasks", { preHandler: requirePermission("tasks", "consultation") }, async (request, reply) => {
    const parsed = listTasksQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Paramètres invalides.", details: parsed.error.issues });
    }
    const { assignee, status, manuscript } = parsed.data;
    const assigneeId = assignee === "me" ? request.user!.id : assignee;

    const tasks = await prisma.task.findMany({
      where: {
        deletedAt: null,
        ...(assigneeId ? { assigneeId } : {}),
        ...(status ? { status } : {}),
        ...(manuscript ? { manuscriptId: manuscript } : {}),
      },
      include: { manuscript: { select: { id: true, manuscriptNumber: true, title: true } }, assignee: { select: { id: true, username: true } } },
      orderBy: { plannedStart: "asc" },
    });
    return reply.send(tasks);
  });

  // « Mes corrections » : boîte de travail personnelle du correcteur — ses
  // tâches de correction, avec l'ENTRÉE (le manuscrit à corriger) et la SORTIE
  // (la version corrigée à déposer, reçue par la Maquette). On indique si le
  // fichier source et la version corrigée existent, pour afficher les bons accès.
  fastify.get("/api/v1/my-corrections", { preHandler: requirePermission("tasks", "consultation") }, async (request, reply) => {
    const tasks = await prisma.task.findMany({
      where: { deletedAt: null, assigneeId: request.user!.id, type: { in: CORRECTION_TASK_TYPES } },
      include: { manuscript: { select: { id: true, manuscriptNumber: true, title: true } } },
      orderBy: { plannedEnd: "asc" },
    });
    const manuscriptIds = Array.from(new Set(tasks.map((t) => t.manuscriptId)));
    const docs = manuscriptIds.length
      ? await prisma.document.findMany({
          where: { entityType: "manuscript", entityId: { in: manuscriptIds }, category: "manuscrit", deletedAt: null },
          select: { entityId: true, title: true, versions: { take: 1, select: { id: true } } },
        })
      : [];
    const hasSource = new Set<string>();
    const hasCorrected = new Set<string>();
    for (const d of docs) {
      if (!d.versions.length) continue;
      if (d.title === CORRECTED_DOC_TITLE) hasCorrected.add(d.entityId);
      else hasSource.add(d.entityId);
    }
    return reply.send(
      tasks.map((t) => ({
        id: t.id,
        title: t.title,
        type: t.type,
        status: t.status,
        progressPct: t.progressPct,
        plannedEnd: t.plannedEnd,
        manuscript: t.manuscript,
        manuscriptHasFile: hasSource.has(t.manuscriptId),
        correctedHasFile: hasCorrected.has(t.manuscriptId),
      })),
    );
  });

  // ENTRÉE de la tâche : le correcteur télécharge le manuscrit à corriger,
  // DEPUIS sa tâche, sans détenir le droit large « documents ». Réservé au
  // correcteur affecté (les responsables passent par la fiche de l'ouvrage).
  fastify.get("/api/v1/tasks/:id/manuscript-file", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await prisma.task.findFirst({ where: { id, deletedAt: null } });
    if (!task) return reply.code(404).send({ code: "not_found", message: "Tâche introuvable." });
    if (task.assigneeId !== request.user!.id) {
      return reply.code(403).send({ code: "forbidden", message: "Cette tâche de correction ne vous est pas affectée." });
    }
    const doc = await prisma.document.findFirst({
      where: { entityType: "manuscript", entityId: task.manuscriptId, category: "manuscrit", deletedAt: null, NOT: { title: CORRECTED_DOC_TITLE } },
      orderBy: { createdAt: "asc" },
      select: { versions: { take: 1, orderBy: { versionNumber: "desc" } } },
    });
    const version = doc?.versions[0];
    if (!version) {
      return reply.code(404).send({ code: "no_manuscript_file", message: "Aucun fichier manuscrit n'a encore été déposé pour cet ouvrage." });
    }
    const buffer = await readStoredFile(version.filePath);
    reply.header("content-type", version.mimeType);
    return reply.send(buffer);
  });

  // SORTIE de la tâche : le correcteur dépose la version corrigée. Enregistrée
  // comme une nouvelle version du document « Manuscrit corrigé » (versionnage
  // conservé, Ch. 10) et reçue par la Maquette. Réservé au correcteur affecté.
  fastify.post("/api/v1/tasks/:id/corrected-file", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await prisma.task.findFirst({ where: { id, deletedAt: null } });
    if (!task) return reply.code(404).send({ code: "not_found", message: "Tâche introuvable." });
    if (task.assigneeId !== request.user!.id) {
      return reply.code(403).send({ code: "forbidden", message: "Seul le correcteur affecté peut déposer la version corrigée." });
    }
    const file = await request.file();
    if (!file) return reply.code(400).send({ code: "validation_error", message: "Fichier requis." });
    const buffer = await file.toBuffer();
    if (buffer.length === 0) return reply.code(400).send({ code: "empty_file", message: "Le fichier est vide." });
    const stored = await storeFile(buffer, `manuscrit-corrige-${task.manuscriptId}-${file.filename}`);

    let doc = await prisma.document.findFirst({
      where: { entityType: "manuscript", entityId: task.manuscriptId, category: "manuscrit", title: CORRECTED_DOC_TITLE, deletedAt: null },
    });
    if (!doc) {
      doc = await prisma.document.create({
        data: { entityType: "manuscript", entityId: task.manuscriptId, category: "manuscrit", title: CORRECTED_DOC_TITLE, createdBy: request.user!.id, updatedBy: request.user!.id },
      });
    }
    const last = await prisma.documentVersion.findFirst({ where: { documentId: doc.id }, orderBy: { versionNumber: "desc" } });
    const version = await prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        versionNumber: (last?.versionNumber ?? 0) + 1,
        filePath: stored.filePath,
        fileSize: stored.fileSize,
        mimeType: file.mimetype,
        sha256Hash: stored.sha256Hash,
        changeSummary: "Version corrigée déposée par le correcteur",
        uploadedBy: request.user!.id,
      },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "document_version", entityId: version.id, newValues: { corrected_manuscript: true, versionNumber: version.versionNumber }, ipAddress: request.ip });
    return reply.code(201).send({ corrected_has_file: true, version_number: version.versionNumber });
  });

  fastify.patch("/api/v1/tasks/:id", { preHandler: requirePermission("tasks", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = patchTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }

    const existing = await prisma.task.findFirst({ where: { id, deletedAt: null } });
    if (!existing) {
      return reply.code(404).send({ code: "not_found", message: "Tâche introuvable." });
    }

    if (parsed.data.status === "validee" && !request.user!.permissions.has("tasks:validation")) {
      return reply.code(403).send({ code: "forbidden", message: "Seul un rôle habilité peut valider une tâche." });
    }

    const updated = await prisma.task.update({
      where: { id },
      data: {
        progressPct: parsed.data.progress_pct,
        status: parsed.data.status,
        plannedEnd: parsed.data.planned_end,
        actualEnd: parsed.data.status === "terminee" || parsed.data.status === "validee" ? new Date() : existing.actualEnd,
        actualStart: parsed.data.status === "en_cours" && !existing.actualStart ? new Date() : existing.actualStart,
        updatedBy: request.user!.id,
      },
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "task",
      entityId: id,
      oldValues: { status: existing.status, progressPct: existing.progressPct },
      newValues: parsed.data,
      ipAddress: request.ip,
    });

    return reply.send(updated);
  });

  // Glisser-déposer d'échéance (Ch. 8 §8.7) : recalcule les tâches
  // dépendantes du même décalage et signale les conflits (tâche dépendante
  // déjà engagée alors que son échéance amont bouge).
  fastify.patch(
    "/api/v1/tasks/:id/reschedule",
    { preHandler: requirePermission("tasks", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = rescheduleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const task = await prisma.task.findFirst({ where: { id, deletedAt: null } });
      if (!task) {
        return reply.code(404).send({ code: "not_found", message: "Tâche introuvable." });
      }

      const { planned_start, planned_end, justification } = parsed.data;
      const referenceOld = task.plannedEnd ?? task.plannedStart;
      const referenceNew = planned_end ?? planned_start;
      const deltaMs = referenceOld && referenceNew ? referenceNew.getTime() - referenceOld.getTime() : 0;

      const conflicts: { task_id: string; title: string; reason: string }[] = [];
      const cascaded: { id: string; plannedStart: Date | null; plannedEnd: Date | null }[] = [];

      await prisma.$transaction(async (tx) => {
        await tx.task.update({
          where: { id },
          data: {
            plannedStart: planned_start ?? task.plannedStart,
            plannedEnd: planned_end ?? task.plannedEnd,
            updatedBy: request.user!.id,
          },
        });

        if (deltaMs !== 0) {
          const visited = new Set<string>([id]);
          let frontier = [id];
          while (frontier.length > 0) {
            const dependents = await tx.task.findMany({ where: { dependsOnTaskId: { in: frontier }, deletedAt: null } });
            frontier = [];
            for (const dependent of dependents) {
              if (visited.has(dependent.id)) continue;
              visited.add(dependent.id);
              frontier.push(dependent.id);

              const newStart = dependent.plannedStart ? new Date(dependent.plannedStart.getTime() + deltaMs) : null;
              const newEnd = dependent.plannedEnd ? new Date(dependent.plannedEnd.getTime() + deltaMs) : null;

              if (ENGAGED_STATUSES.includes(dependent.status)) {
                conflicts.push({
                  task_id: dependent.id,
                  title: dependent.title,
                  reason: `Tâche déjà « ${dependent.status} » : le décalage de son échéance amont crée un conflit à arbitrer manuellement.`,
                });
              }

              await tx.task.update({ where: { id: dependent.id }, data: { plannedStart: newStart, plannedEnd: newEnd } });
              cascaded.push({ id: dependent.id, plannedStart: newStart, plannedEnd: newEnd });
            }
          }
        }
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "task",
        entityId: id,
        oldValues: { plannedStart: task.plannedStart, plannedEnd: task.plannedEnd },
        newValues: { plannedStart: planned_start ?? task.plannedStart, plannedEnd: planned_end ?? task.plannedEnd, justification },
        ipAddress: request.ip,
      });

      return reply.send({ cascaded, conflicts });
    },
  );

  fastify.get("/api/v1/gantt", { preHandler: requirePermission("tasks", "consultation") }, async (request, reply) => {
    const parsed = ganttQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Paramètres invalides.", details: parsed.error.issues });
    }
    const { collection, manager } = parsed.data;

    const manuscripts = await prisma.manuscript.findMany({
      where: {
        deletedAt: null,
        ...(collection ? { collectionId: collection } : {}),
        ...(manager ? { projectManagerId: manager } : {}),
      },
      select: {
        id: true,
        manuscriptNumber: true,
        title: true,
        tasks: {
          where: { deletedAt: null },
          orderBy: { plannedStart: "asc" },
          include: { assignee: { select: { id: true, username: true } } },
        },
      },
    });

    return reply.send(manuscripts.filter((m) => m.tasks.length > 0));
  });
}
