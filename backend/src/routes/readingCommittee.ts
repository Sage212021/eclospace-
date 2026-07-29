import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EvaluationRecommendation, EditorialDecisionType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission, requireAuth } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { storeFile, readStoredFile } from "../lib/storage.js";

const DEFAULT_RATING_THRESHOLDS = { excellent: 8.5, very_good: 7, good: 5, to_rework: 3 };
const DEFAULT_SCORE_GAP_THRESHOLD = 3;

const assignReaderSchema = z.object({
  reader_id: z.string().uuid(),
  due_at: z.coerce.date(),
});

const listAssignmentsQuerySchema = z.object({
  reader: z.string().optional(), // "me" ou un id — Ch. 7 §7.3
  status: z.enum(["pending", "submitted", "late", "cancelled"]).optional(),
  manuscript: z.string().uuid().optional(),
});

const evaluationSchema = z.object({
  scores: z.array(z.object({ criterion_id: z.string().uuid(), score: z.number().min(0).max(10), comment: z.string().optional() })),
  overall_comment: z.string().optional(),
  recommendation: z.nativeEnum(EvaluationRecommendation),
  visibility: z.enum(["confidentiel", "direction_seule", "comite", "dossier_editorial"]).default("comite"),
});

const editorialDecisionSchema = z.object({
  decision: z.nativeEnum(EditorialDecisionType),
  motivation: z.string().min(1),
});

async function ratingThresholds() {
  const setting = await prisma.setting.findUnique({ where: { key: "evaluation_rating_thresholds" } });
  return (setting?.value as typeof DEFAULT_RATING_THRESHOLDS | undefined) ?? DEFAULT_RATING_THRESHOLDS;
}

function ratingFor(score: number, thresholds: typeof DEFAULT_RATING_THRESHOLDS) {
  if (score >= thresholds.excellent) return "excellent" as const;
  if (score >= thresholds.very_good) return "very_good" as const;
  if (score >= thresholds.good) return "good" as const;
  if (score >= thresholds.to_rework) return "to_rework" as const;
  return "refused" as const;
}

// Comité de lecture (Ch. 7) et décision éditoriale (Ch. 8 §8.2).
export default async function readingCommitteeRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/api/v1/manuscripts/:id/reading-assignments",
    { preHandler: requirePermission("comite_lecture", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = assignReaderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }

      // Anti-doublon : un même relecteur ne peut pas cumuler plusieurs missions
      // en cours sur le même manuscrit (évite les « évaluation en attente »
      // fantômes qui bloquent ensuite le passage à l'étape suivante).
      const duplicate = await prisma.readingAssignment.findFirst({
        where: { manuscriptId: id, readerId: parsed.data.reader_id, status: { in: ["pending", "late"] } },
        include: { reader: { select: { username: true } } },
      });
      if (duplicate) {
        return reply.code(409).send({
          code: "reader_already_assigned",
          message: `${duplicate.reader.username} a déjà une mission de lecture en cours sur ce manuscrit.`,
        });
      }

      const assignment = await prisma.readingAssignment.create({
        data: { manuscriptId: id, readerId: parsed.data.reader_id, dueAt: parsed.data.due_at },
      });

      await prisma.notification.create({
        data: {
          userId: parsed.data.reader_id,
          type: "affectation",
          priority: "medium",
          title: "Nouvelle lecture assignée",
          body: `Le manuscrit ${manuscript.manuscriptNumber} vous est confié pour évaluation, échéance ${parsed.data.due_at.toLocaleDateString("fr-FR")}.`,
          entityType: "manuscript",
          entityId: id,
        },
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "reading_assignment",
        entityId: assignment.id,
        newValues: { manuscriptId: id, readerId: parsed.data.reader_id },
        ipAddress: request.ip,
      });

      return reply.code(201).send(assignment);
    },
  );

  fastify.get(
    "/api/v1/reading-assignments",
    { preHandler: requirePermission("comite_lecture", "consultation") },
    async (request, reply) => {
    const parsed = listAssignmentsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Paramètres invalides.", details: parsed.error.issues });
    }
    const { reader, status, manuscript } = parsed.data;
    const readerId = reader === "me" ? request.user!.id : reader;

    const assignments = await prisma.readingAssignment.findMany({
      where: {
        ...(readerId ? { readerId } : {}),
        ...(status ? { status } : {}),
        ...(manuscript ? { manuscriptId: manuscript } : {}),
      },
      include: {
        manuscript: { select: { id: true, manuscriptNumber: true, title: true } },
        // Le rapport d'évaluation soumis (null tant qu'il n'est pas remis) : sert
        // au relecteur à télécharger/imprimer son rapport, et au comité à le lire.
        reader: { select: { username: true } },
        evaluation: {
          include: {
            scores: {
              include: { criterion: { select: { id: true, label: true, coefficient: true } } },
            },
          },
        },
      },
      orderBy: { dueAt: "asc" },
    });
      // On expose l'existence du fichier joint (has_report_file) sans divulguer
      // le chemin de stockage interne.
      return reply.send(
        assignments.map(({ reportFilePath, reportFileMime, ...rest }) => ({
          ...rest,
          hasReportFile: Boolean(reportFilePath),
        })),
      );
    },
  );

  // Retrait (annulation) d'une mission de lecture — pour corriger une
  // affectation erronée ou un doublon. Une mission déjà évaluée (« remise »)
  // n'est jamais retirée (le rapport engage le comité). Si, après retrait, il
  // ne reste plus de mission en attente et qu'au moins un rapport a été remis,
  // le dossier est transmis automatiquement à la décision éditoriale.
  fastify.post(
    "/api/v1/reading-assignments/:id/cancel",
    { preHandler: requirePermission("comite_lecture", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const assignment = await prisma.readingAssignment.findUnique({ where: { id } });
      if (!assignment) {
        return reply.code(404).send({ code: "not_found", message: "Mission de lecture introuvable." });
      }
      if (assignment.status === "submitted") {
        return reply.code(409).send({ code: "already_submitted", message: "Cette évaluation a déjà été remise : elle ne peut pas être retirée." });
      }
      if (assignment.status === "cancelled") {
        return reply.send({ ok: true, advanced: false });
      }

      await prisma.readingAssignment.update({ where: { id }, data: { status: "cancelled" } });
      await writeAuditLog({
        userId: request.user!.id,
        action: "status_change",
        entityType: "reading_assignment",
        entityId: id,
        oldValues: { status: assignment.status },
        newValues: { status: "cancelled" },
        ipAddress: request.ip,
      });

      const remaining = await prisma.readingAssignment.count({
        where: { manuscriptId: assignment.manuscriptId, status: { in: ["pending", "late"] } },
      });
      const submitted = await prisma.readingAssignment.count({
        where: { manuscriptId: assignment.manuscriptId, status: "submitted" },
      });
      let advanced = false;
      if (remaining === 0 && submitted > 0) {
        advanced = await completeReadingCommitteeStep(assignment.manuscriptId, request.user!.id);
      }
      return reply.send({ ok: true, advanced });
    },
  );

  // Clôture manuelle du comité de lecture par un responsable éditorial : annule
  // les missions encore en attente et transmet le dossier à la décision
  // éditoriale. Exige qu'au moins un rapport ait été remis (on ne décide pas
  // d'un ouvrage sans lecture). Donne au responsable un moyen explicite de
  // « passer à la suite » sans attendre des relecteurs qui ne rendront pas.
  fastify.post(
    "/api/v1/manuscripts/:id/close-reading-committee",
    { preHandler: requirePermission("comite_lecture", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, include: { status: true } });
      if (!manuscript) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }
      if (manuscript.status.code !== "COMITE_LECTURE") {
        return reply.code(409).send({
          code: "step_out_of_order",
          message: `Le manuscrit est à l'étape « ${manuscript.status.label} », pas au comité de lecture.`,
        });
      }
      const submitted = await prisma.readingAssignment.count({ where: { manuscriptId: id, status: "submitted" } });
      if (submitted === 0) {
        return reply.code(409).send({
          code: "no_evaluation",
          message: "Au moins un rapport de lecture doit être remis avant de clore le comité.",
        });
      }

      await prisma.readingAssignment.updateMany({
        where: { manuscriptId: id, status: { in: ["pending", "late"] } },
        data: { status: "cancelled" },
      });
      const advanced = await completeReadingCommitteeStep(id, request.user!.id);
      await writeAuditLog({
        userId: request.user!.id,
        action: "validate",
        entityType: "manuscript",
        entityId: id,
        newValues: { step: "COMITE_LECTURE", closed: true },
        ipAddress: request.ip,
      });
      return reply.send({ ok: true, advanced });
    },
  );

  // Dépôt d'un fichier externe de rapport de relecture (le document rédigé par
  // le relecteur, qui a servi à l'évaluation). Le relecteur dépose le sien ;
  // stocké tel quel (PDF, Word…), servi en téléchargement.
  fastify.post("/api/v1/reading-assignments/:id/report-file", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const assignment = await prisma.readingAssignment.findUnique({ where: { id } });
    if (!assignment) return reply.code(404).send({ code: "not_found", message: "Mission de lecture introuvable." });
    if (assignment.readerId !== request.user!.id) {
      return reply.code(403).send({ code: "forbidden", message: "Seul le relecteur peut joindre son rapport." });
    }
    const file = await request.file();
    if (!file) return reply.code(400).send({ code: "validation_error", message: "Fichier requis." });
    const buffer = await file.toBuffer();
    if (buffer.length === 0) return reply.code(400).send({ code: "empty_file", message: "Le fichier est vide." });
    const stored = await storeFile(buffer, `rapport-lecture-${id}-${file.filename}`);
    await prisma.readingAssignment.update({
      where: { id },
      data: { reportFilePath: stored.filePath, reportFileName: file.filename, reportFileMime: file.mimetype, reportFileSize: stored.fileSize },
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "reading_assignment", entityId: id, newValues: { report_file: "uploaded" }, ipAddress: request.ip });
    return reply.send({ has_report_file: true, report_file_name: file.filename });
  });

  // Téléchargement du fichier joint — accessible au relecteur, au comité et à
  // la direction (comite_lecture:consultation).
  fastify.get(
    "/api/v1/reading-assignments/:id/report-file",
    { preHandler: requirePermission("comite_lecture", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const assignment = await prisma.readingAssignment.findUnique({ where: { id } });
      if (!assignment || !assignment.reportFilePath) {
        return reply.code(404).send({ code: "no_report_file", message: "Aucun rapport joint pour cette mission." });
      }
      const buffer = await readStoredFile(assignment.reportFilePath);
      reply.header("content-type", assignment.reportFileMime ?? "application/octet-stream");
      reply.header("content-disposition", `attachment; filename="${(assignment.reportFileName ?? "rapport-de-lecture").replace(/"/g, "")}"`);
      return reply.send(buffer);
    },
  );

  fastify.post(
    "/api/v1/reading-assignments/:id/evaluation",
    { preHandler: requirePermission("comite_lecture", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = evaluationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const assignment = await prisma.readingAssignment.findUnique({ where: { id } });
      if (!assignment) {
        return reply.code(404).send({ code: "not_found", message: "Mission de lecture introuvable." });
      }
      if (assignment.readerId !== request.user!.id) {
        return reply.code(403).send({ code: "forbidden", message: "Cette mission n'est pas la vôtre." });
      }
      if (assignment.status === "submitted") {
        return reply.code(409).send({ code: "already_submitted", message: "Cette évaluation a déjà été remise." });
      }

      const activeCriteria = await prisma.evaluationCriterion.findMany({ where: { isActive: true } });
      const missing = activeCriteria.filter((c) => !parsed.data.scores.some((s) => s.criterion_id === c.id));
      if (missing.length > 0) {
        return reply.code(409).send({
          code: "incomplete_grid",
          message: `Grille incomplète : critère(s) manquant(s) : ${missing.map((c) => c.label).join(", ")}.`,
        });
      }

      const coefficientById = new Map(activeCriteria.map((c) => [c.id, Number(c.coefficient)]));
      const totalCoefficient = activeCriteria.reduce((sum, c) => sum + Number(c.coefficient), 0);
      const weightedSum = parsed.data.scores.reduce((sum, s) => sum + s.score * (coefficientById.get(s.criterion_id) ?? 0), 0);
      const globalScore = totalCoefficient > 0 ? weightedSum / totalCoefficient : 0;
      const thresholds = await ratingThresholds();
      const rating = ratingFor(globalScore, thresholds);
      const now = new Date();

      const evaluation = await prisma.$transaction(async (tx) => {
        const created = await tx.evaluation.create({
          data: {
            assignmentId: id,
            overallComment: parsed.data.overall_comment,
            recommendation: parsed.data.recommendation,
            globalScore,
            rating,
            visibility: parsed.data.visibility,
            scores: {
              create: parsed.data.scores.map((s) => ({ criterionId: s.criterion_id, score: s.score, comment: s.comment })),
            },
          },
        });
        await tx.readingAssignment.update({ where: { id }, data: { status: "submitted", submittedAt: now } });
        return created;
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "evaluation",
        entityId: evaluation.id,
        newValues: { assignmentId: id, globalScore, rating },
        ipAddress: request.ip,
      });

      // Ch. 7 §7.12 : dès que tous les rapports attendus sont remis, le
      // dossier est automatiquement transmis à la Direction éditoriale.
      const remaining = await prisma.readingAssignment.count({
        where: { manuscriptId: assignment.manuscriptId, status: { in: ["pending", "late"] } },
      });
      if (remaining === 0) {
        await completeReadingCommitteeStep(assignment.manuscriptId, request.user!.id);
      }

      return reply.code(201).send(evaluation);
    },
  );

  fastify.post(
    "/api/v1/manuscripts/:id/editorial-decision",
    { preHandler: requirePermission("decision_editoriale", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = editorialDecisionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, include: { status: true } });
      if (!manuscript) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }
      if (manuscript.status.code !== "DECISION_EDITORIALE") {
        return reply.code(409).send({
          code: "step_out_of_order",
          message: `Le manuscrit est à l'étape « ${manuscript.status.label} », pas encore à la décision éditoriale.`,
        });
      }

      const evaluations = await prisma.evaluation.findMany({
        where: { assignment: { manuscriptId: id } },
      });
      const scores = evaluations.map((e) => Number(e.globalScore));
      const scoreGapSetting = await prisma.setting.findUnique({ where: { key: "evaluation_score_gap_threshold" } });
      const gapThreshold = (scoreGapSetting?.value as number | undefined) ?? DEFAULT_SCORE_GAP_THRESHOLD;
      const scoreGapFlag = scores.length > 1 && Math.max(...scores) - Math.min(...scores) >= gapThreshold;

      const now = new Date();
      const decision = await prisma.$transaction(async (tx) => {
        const created = await tx.editorialDecision.create({
          data: {
            manuscriptId: id,
            decision: parsed.data.decision,
            decidedById: request.user!.id,
            motivation: parsed.data.motivation,
            scoreGapFlag,
          },
        });

        const isTerminalDecision = ["acceptation", "acceptation_conditions", "refus"].includes(parsed.data.decision);
        if (isTerminalDecision) {
          await tx.manuscriptStep.upsert({
            where: { manuscriptId_statusId: { manuscriptId: id, statusId: manuscript.statusId } },
            update: { validationBy: request.user!.id, validatedAt: now, observations: parsed.data.motivation },
            create: {
              manuscriptId: id,
              statusId: manuscript.statusId,
              validationBy: request.user!.id,
              validatedAt: now,
              observations: parsed.data.motivation,
            },
          });

          // Ch. 4 §4.3 étape 4 : un refus clôt le workflow (archivage direct) ;
          // une acceptation avance vers la contractualisation (étape 5, Lot 2).
          const nextCode = parsed.data.decision === "refus" ? "ARCHIVAGE" : "CONTRACTUALISATION";
          const nextStatus = await tx.workflowStatus.findUniqueOrThrow({ where: { code: nextCode } });
          await tx.manuscript.update({ where: { id }, data: { statusId: nextStatus.id, updatedBy: request.user!.id } });
          await tx.stepTransition.create({
            data: {
              manuscriptId: id,
              fromStatusCode: "DECISION_EDITORIALE",
              toStatusCode: nextStatus.code,
              responsibleId: request.user!.id,
              observations: parsed.data.motivation,
            },
          });
        }

        return created;
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "validate",
        entityType: "manuscript",
        entityId: id,
        newValues: { decision: parsed.data.decision, scoreGapFlag },
        ipAddress: request.ip,
      });

      return reply.code(201).send(decision);
    },
  );
}

async function completeReadingCommitteeStep(manuscriptId: string, userId: string): Promise<boolean> {
  const comiteStatus = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "COMITE_LECTURE" } });
  const decisionStatus = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "DECISION_EDITORIALE" } });
  const now = new Date();

  // Garde-fou : ne transmettre que si le manuscrit est encore au comité de
  // lecture (évite un double passage si l'étape a déjà avancé).
  const current = await prisma.manuscript.findUniqueOrThrow({ where: { id: manuscriptId }, select: { statusId: true } });
  if (current.statusId !== comiteStatus.id) return false;

  await prisma.$transaction(async (tx) => {
    await tx.manuscriptStep.upsert({
      where: { manuscriptId_statusId: { manuscriptId, statusId: comiteStatus.id } },
      update: { validatedAt: now, validationBy: userId },
      create: { manuscriptId, statusId: comiteStatus.id, validatedAt: now, validationBy: userId, actualStart: now, actualEnd: now },
    });
    await tx.manuscript.update({ where: { id: manuscriptId }, data: { statusId: decisionStatus.id } });
    await tx.stepTransition.create({
      data: {
        manuscriptId,
        fromStatusCode: comiteStatus.code,
        toStatusCode: decisionStatus.code,
        fromDepartmentId: comiteStatus.departmentId,
        toDepartmentId: decisionStatus.departmentId,
        responsibleId: userId,
      },
    });

    if (decisionStatus.departmentId) {
      const departmentUsers = await tx.user.findMany({
        where: { userRoles: { some: { revokedAt: null, role: { departmentId: decisionStatus.departmentId } } }, status: "active" },
      });
      const manuscript = await tx.manuscript.findUniqueOrThrow({ where: { id: manuscriptId } });
      for (const departmentUser of departmentUsers) {
        await tx.notification.create({
          data: {
            userId: departmentUser.id,
            type: "validation",
            priority: "high",
            title: "Décision éditoriale à prendre",
            body: `Tous les rapports de lecture du manuscrit ${manuscript.manuscriptNumber} sont remis.`,
            entityType: "manuscript",
            entityId: manuscriptId,
          },
        });
      }
    }
  });
  return true;
}
