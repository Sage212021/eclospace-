import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EvaluationRecommendation, EditorialDecisionType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission, requireAuth } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";

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
      return reply.send(assignments);
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

async function completeReadingCommitteeStep(manuscriptId: string, userId: string) {
  const comiteStatus = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "COMITE_LECTURE" } });
  const decisionStatus = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "DECISION_EDITORIALE" } });
  const now = new Date();

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
}
