import type { FastifyInstance } from "fastify";
import { z } from "zod";
import argon2 from "argon2";
import { EvaluationRecommendation, EditorialDecisionType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission, requireAuth } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { storeFile, readStoredFile } from "../lib/storage.js";
import { validatePasswordComplexity } from "../lib/passwordPolicy.js";
import { isMailConfigured, sendMail, senderIdentity } from "../lib/mailer.js";
import { resolveLetterTemplates, composeLetter, letterEmailHtml, houseName, buildPointsBlock, LETTER_KEYS, LETTER_LABELS, DEFAULT_LETTERS, type EditorialLetterKey } from "../lib/editorialLetters.js";
import { getBranding } from "../lib/branding.js";
import { readingCommitteeRules, DEFAULT_READING_COMMITTEE_RULES, READING_COMMITTEE_RULES_KEY } from "../lib/readingCommitteeRules.js";
import { parseGrilleScores } from "../lib/aiEvaluationScores.js";
import { createHash } from "node:crypto";

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
  // Type de grille choisi par le relecteur sur son écran (sinon : type de
  // l'ouvrage). Détermine la grille de validation ET de calcul du score.
  grid_genre_id: z.string().uuid().nullable().optional(),
  overall_comment: z.string().optional(),
  recommendation: z.nativeEnum(EvaluationRecommendation),
  // Recommandation en texte libre (précisions du relecteur), en complément.
  recommendation_note: z.string().max(4000).optional(),
  // Nom du relecteur (défaut applicatif si vide : « Comité de lecture d'Éclosion Édition »).
  reviewer_name: z.string().max(200).optional(),
  visibility: z.enum(["confidentiel", "direction_seule", "comite", "dossier_editorial"]).default("comite"),
  // Déclaration de conflit d'intérêt (point n°3) : exigée seulement si la règle
  // est activée ; sinon ignorée. `details` requis si un conflit est signalé.
  conflict_declaration: z.object({ has_conflict: z.boolean(), details: z.string().optional() }).optional(),
});

const editorialDecisionSchema = z.object({
  decision: z.nativeEnum(EditorialDecisionType),
  // Motivation INTERNE (dossier, historique) — jamais reproduite dans la lettre.
  motivation: z.string().min(1),
  // Acceptation « sous conditions » (audit éditorial, point n°2) : la liste des
  // conditions à lever avant production. Ignorée pour les autres décisions.
  conditions: z.array(z.string().min(1)).optional(),
  // Éléments COMMUNICABLES à l'auteur, validés par la Direction : message
  // complémentaire + points essentiels (conditions / axes de révision / motifs).
  // Seuls ces éléments alimentent la lettre — jamais le rapport du comité.
  author_message: z.string().max(4000).optional(),
  author_points: z.array(z.string().min(1).max(500)).max(20).optional(),
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

// Rôles habilités à recevoir une lecture / correction d'un ouvrage (décision
// opérateur du 30/07/2026) : correcteur, membre du comité, assistant éditorial,
// direction éditoriale et DG (+ l'administrateur général). On ne propose à
// l'affectation QUE ces profils — jamais les auteurs ni les autres pôles.
const READER_ROLE_CODES = [
  "CORRECTEUR",
  "MEMBRE_COMITE_LECTURE",
  "ASSISTANT_EDITORIAL",
  "DIR_EDITORIAL",
  "DIR_GENERAL",
  "ADMIN_GENERAL",
];

// Un relecteur EXTERNE est un compte externe (comme l'espace auteur) portant le
// rôle « membre du comité de lecture » : il se connecte à un espace dédié pour
// faire ses lectures, sans accéder à l'ERP interne.
const EXTERNAL_REVIEWER_ROLE = "MEMBRE_COMITE_LECTURE";

const createExternalReviewerSchema = z.object({
  username: z.string().trim().min(3).max(60),
  email: z.string().trim().email(),
  password: z.string().min(8),
});

// Comité de lecture (Ch. 7) et décision éditoriale (Ch. 8 §8.2).
export default async function readingCommitteeRoutes(fastify: FastifyInstance) {
  // Candidats à l'affectation d'une lecture : les comptes internes portant un
  // rôle éditorial de lecture/correction, ET les relecteurs EXTERNES (comptes
  // externes « membre du comité de lecture »). Jamais un auteur ni un autre pôle.
  fastify.get(
    "/api/v1/reading-candidates",
    { preHandler: requirePermission("comite_lecture", "saisie") },
    async (_request, reply) => {
      const users = await prisma.user.findMany({
        where: {
          deletedAt: null,
          status: "active",
          OR: [
            { accountType: "internal", userRoles: { some: { revokedAt: null, role: { code: { in: READER_ROLE_CODES } } } } },
            { accountType: "external", userRoles: { some: { revokedAt: null, role: { code: EXTERNAL_REVIEWER_ROLE } } } },
          ],
        },
        select: { id: true, username: true, accountType: true },
        orderBy: { username: "asc" },
      });
      return reply.send(users.map((u) => ({ id: u.id, username: u.username, external: u.accountType === "external" })));
    },
  );

  // Création d'un relecteur EXTERNE (compte externe dédié) : identifiant,
  // e-mail, mot de passe + rôle « membre du comité de lecture ». Il se connecte
  // à son espace relecteur pour faire ses lectures. Réservé aux profils qui
  // affectent les lectures (comite_lecture:saisie).
  fastify.post(
    "/api/v1/reading-candidates/external",
    { preHandler: requirePermission("comite_lecture", "saisie") },
    async (request, reply) => {
      const parsed = createExternalReviewerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const { username, email, password } = parsed.data;
      const complexityError = validatePasswordComplexity(password);
      if (complexityError) {
        return reply.code(400).send({ code: "weak_password", message: complexityError });
      }
      if (await prisma.user.findFirst({ where: { username, deletedAt: null } })) {
        return reply.code(409).send({ code: "username_taken", message: `L'identifiant « ${username} » est déjà utilisé.` });
      }
      if (await prisma.user.findFirst({ where: { email, deletedAt: null } })) {
        return reply.code(409).send({ code: "email_taken", message: `L'e-mail « ${email} » est déjà utilisé.` });
      }
      const role = await prisma.role.findUniqueOrThrow({ where: { code: EXTERNAL_REVIEWER_ROLE } });
      const passwordHash = await argon2.hash(password);
      const user = await prisma.user.create({
        data: {
          username,
          email,
          passwordHash,
          accountType: "external",
          status: "active",
          createdBy: request.user!.id,
          updatedBy: request.user!.id,
          userRoles: { create: [{ roleId: role.id, grantedBy: request.user!.id, justification: "Relecteur externe (compte dédié)." }] },
        },
        select: { id: true, username: true },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "user",
        entityId: user.id,
        newValues: { accountType: "external", role: EXTERNAL_REVIEWER_ROLE, reviewer: true },
        ipAddress: request.ip,
      });
      return reply.code(201).send({ id: user.id, username: user.username, external: true });
    },
  );

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
          // Cette notification porte une vraie échéance : elle reste visible
          // jusqu'à la date limite de la mission (et non 24 h seulement).
          expiresAt: parsed.data.due_at,
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

      // Entrée du relecteur : le manuscrit qui lui est confié. On indique si un
      // fichier « manuscrit » est déposé sur l'ouvrage (et son nom), pour offrir
      // au relecteur un accès direct en lecture — sans lui donner le droit large
      // « documents » (il télécharge via sa mission, cf. route dédiée ci-dessous).
      const manuscriptIds = Array.from(new Set(assignments.map((a) => a.manuscriptId)));
      const manuscriptDocs = manuscriptIds.length
        ? await prisma.document.findMany({
            where: { entityType: "manuscript", entityId: { in: manuscriptIds }, category: "manuscrit", deletedAt: null },
            select: { entityId: true, versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { fileSize: true } }, title: true },
          })
        : [];
      const fileByManuscript = new Map<string, string>();
      for (const d of manuscriptDocs) if (d.versions.length && !fileByManuscript.has(d.entityId)) fileByManuscript.set(d.entityId, d.title);

      // On expose l'existence du fichier joint (has_report_file) sans divulguer
      // le chemin de stockage interne.
      return reply.send(
        assignments.map(({ reportFilePath, reportFileMime, ...rest }) => ({
          ...rest,
          hasReportFile: Boolean(reportFilePath),
          manuscriptHasFile: fileByManuscript.has(rest.manuscriptId),
          manuscriptFileTitle: fileByManuscript.get(rest.manuscriptId) ?? null,
        })),
      );
    },
  );

  // Entrée/sortie du relecteur (transmission de fichiers entre étapes) : le
  // relecteur télécharge, DEPUIS SA MISSION, le manuscrit qui lui est confié —
  // sans détenir le droit large « documents:consultation ». Réservé au relecteur
  // affecté (les responsables passent par la fiche de l'ouvrage). Sa sortie —
  // le rapport de lecture — est déposée via .../report-file et reçue à l'étape
  // suivante (décision éditoriale).
  fastify.get("/api/v1/reading-assignments/:id/manuscript-file", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const assignment = await prisma.readingAssignment.findUnique({ where: { id } });
    if (!assignment) {
      return reply.code(404).send({ code: "not_found", message: "Mission introuvable." });
    }
    if (assignment.readerId !== request.user!.id) {
      return reply.code(403).send({ code: "forbidden", message: "Cette mission de lecture n'est pas la vôtre." });
    }
    const doc = await prisma.document.findFirst({
      where: { entityType: "manuscript", entityId: assignment.manuscriptId, category: "manuscrit", deletedAt: null },
      select: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    const version = doc?.versions[0];
    if (!version) {
      return reply.code(404).send({ code: "no_manuscript_file", message: "Aucun fichier manuscrit n'a encore été déposé pour cet ouvrage." });
    }
    const buffer = await readStoredFile(version.filePath);
    reply.header("content-type", version.mimeType);
    return reply.send(buffer);
  });

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

  // Envoi par e-mail de la version FINALE du rapport (rapport officiel à en-tête
  // + rapport déposé, fusionnés côté navigateur en PDF). Le PDF arrive en base64
  // et part en pièce jointe. Accessible au relecteur de la mission OU au comité /
  // direction (consultation). L'expédition externe n'est jamais silencieuse.
  fastify.post("/api/v1/reading-assignments/:id/email-report", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        to: z.string().email(),
        subject: z.string().max(300).optional(),
        message: z.string().max(8000).optional(),
        pdf_base64: z.string().min(10),
        file_name: z.string().max(200).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });

    const assignment = await prisma.readingAssignment.findUnique({ where: { id }, include: { manuscript: { select: { title: true, manuscriptNumber: true } } } });
    if (!assignment) return reply.code(404).send({ code: "not_found", message: "Mission de lecture introuvable." });
    const isReader = assignment.readerId === request.user!.id;
    const canOversee = request.user!.permissions.has("comite_lecture:consultation");
    if (!isReader && !canOversee) return reply.code(403).send({ code: "forbidden", message: "Vous n'êtes pas autorisé à transmettre ce rapport." });

    if (!isMailConfigured()) {
      return reply.code(503).send({ code: "email_not_configured", message: "L'envoi d'e-mail n'est pas configuré sur ce serveur. Téléchargez le rapport et transmettez-le manuellement." });
    }

    const buffer = Buffer.from(parsed.data.pdf_base64, "base64");
    const title = assignment.manuscript?.title ?? "l'ouvrage";
    const subject = parsed.data.subject?.trim() || `Rapport de lecture — ${title}`;
    const text = (parsed.data.message?.trim() || `Bonjour,\n\nVeuillez trouver ci-joint le rapport de lecture concernant « ${title} ».\n\nCordialement,\nÉclosion Édition`);
    try {
      const ok = await sendMail({
        to: parsed.data.to.trim(),
        subject,
        text,
        replyTo: request.user!.email,
        attachments: [{ filename: parsed.data.file_name?.trim() || `Rapport-lecture-${assignment.manuscript?.manuscriptNumber ?? id}.pdf`, content: buffer, contentType: "application/pdf" }],
      });
      if (!ok) return reply.code(502).send({ code: "email_failed", message: "L'e-mail n'a pas pu être envoyé (serveur de messagerie indisponible). Réessayez ou transmettez le fichier manuellement." });
    } catch {
      return reply.code(502).send({ code: "email_failed", message: "L'e-mail n'a pas pu être envoyé." });
    }
    await writeAuditLog({ userId: request.user!.id, action: "export", entityType: "reading_assignment", entityId: id, newValues: { emailed_to: parsed.data.to.trim() }, ipAddress: request.ip });
    return reply.send({ sent: true });
  });

  // « Joindre à l'ouvrage » : le relecteur verse SON rapport (le fichier déposé)
  // comme pièce officielle de l'ouvrage (catégorie rapport_lecture), reçue par
  // la Direction éditoriale à l'étape suivante. Réservé au relecteur de la mission.
  fastify.post("/api/v1/reading-assignments/:id/attach-report", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const assignment = await prisma.readingAssignment.findUnique({ where: { id } });
    if (!assignment) return reply.code(404).send({ code: "not_found", message: "Mission de lecture introuvable." });
    if (assignment.readerId !== request.user!.id) {
      return reply.code(403).send({ code: "forbidden", message: "Seul le relecteur peut joindre son rapport." });
    }
    if (!assignment.reportFilePath) {
      return reply.code(409).send({ code: "no_report_file", message: "Joignez d'abord le fichier de votre rapport (« Déposer mon rapport »)." });
    }
    const reader = await prisma.user.findUnique({ where: { id: assignment.readerId }, select: { username: true } });
    const buffer = await readStoredFile(assignment.reportFilePath);
    const sha256Hash = createHash("sha256").update(buffer).digest("hex");
    const title = `Rapport de lecture — ${reader?.username ?? "relecteur"}`;
    let doc = await prisma.document.findFirst({ where: { entityType: "manuscript", entityId: assignment.manuscriptId, category: "rapport_lecture", title, deletedAt: null } });
    if (!doc) {
      doc = await prisma.document.create({ data: { entityType: "manuscript", entityId: assignment.manuscriptId, category: "rapport_lecture", title, createdBy: request.user!.id, updatedBy: request.user!.id } });
    }
    const last = await prisma.documentVersion.findFirst({ where: { documentId: doc.id }, orderBy: { versionNumber: "desc" } });
    const version = await prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        versionNumber: (last?.versionNumber ?? 0) + 1,
        filePath: assignment.reportFilePath,
        fileSize: assignment.reportFileSize ?? buffer.length,
        mimeType: assignment.reportFileMime ?? "application/octet-stream",
        sha256Hash,
        changeSummary: "Rapport de lecture joint à l'ouvrage",
        uploadedBy: request.user!.id,
      },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "document_version", entityId: version.id, newValues: { reading_report_attached: true, manuscriptId: assignment.manuscriptId }, ipAddress: request.ip });
    return reply.code(201).send({ attached: true, document_id: doc.id });
  });

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

      // Grille ADAPTÉE au type du manuscrit (domaine) : grille propre au domaine
      // si elle existe, sinon grille par défaut.
      const ms = await prisma.manuscript.findUnique({ where: { id: assignment.manuscriptId }, select: { genreId: true } });
      const { effectiveCriteria } = await import("../lib/evaluationGrid.js");
      const activeCriteria = await effectiveCriteria(parsed.data.grid_genre_id ?? ms?.genreId ?? null);
      const missing = activeCriteria.filter((c) => !parsed.data.scores.some((s) => s.criterion_id === c.id));
      if (missing.length > 0) {
        return reply.code(409).send({
          code: "incomplete_grid",
          message: `Grille incomplète : critère(s) manquant(s) : ${missing.map((c) => c.label).join(", ")}.`,
        });
      }

      // Déclaration de conflit d'intérêt (point n°3) — seulement si la règle est
      // activée par la maison. Le lecteur déclare « aucun lien » ou signale un
      // conflit (motif obligatoire). Sinon, le champ est facultatif.
      const rules = await readingCommitteeRules();
      const declaration = parsed.data.conflict_declaration;
      if (rules.conflictEnabled) {
        if (!declaration) {
          return reply.code(409).send({
            code: "conflict_declaration_required",
            message: "Déclaration de conflit d'intérêt requise : indiquez « aucun lien avec l'auteur » ou signalez un conflit avant de remettre votre rapport.",
          });
        }
        if (declaration.has_conflict && !declaration.details?.trim()) {
          return reply.code(400).send({ code: "conflict_details_required", message: "Précisez la nature du conflit d'intérêt signalé." });
        }
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
            recommendationNote: parsed.data.recommendation_note?.trim() || null,
            reviewerName: parsed.data.reviewer_name?.trim() || "Comité de lecture d'Éclosion Édition",
            globalScore,
            rating,
            visibility: parsed.data.visibility,
            scores: {
              create: parsed.data.scores.map((s) => ({ criterionId: s.criterion_id, score: s.score, comment: s.comment })),
            },
          },
        });
        await tx.readingAssignment.update({
          where: { id },
          data: {
            status: "submitted",
            submittedAt: now,
            ...(declaration
              ? { conflictDeclaredAt: now, conflictHasConflict: declaration.has_conflict, conflictDetails: declaration.has_conflict ? declaration.details?.trim() ?? null : null }
              : {}),
          },
        });
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

  // Notes proposées par le dernier rapport IA d'évaluation, pour pré-remplir les
  // curseurs du relecteur (Mes lectures). Renvoie des couples (libellé → note/10)
  // que le front rapproche des critères de SA grille ; le relecteur reste libre
  // d'ajuster. Aucune note fiable trouvée → liste vide (pré-remplissage ignoré).
  fastify.get(
    "/api/v1/reading-assignments/:id/ai-evaluation-scores",
    { preHandler: requirePermission("comite_lecture", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const assignment = await prisma.readingAssignment.findUnique({ where: { id } });
      if (!assignment) {
        return reply.code(404).send({ code: "not_found", message: "Mission de lecture introuvable." });
      }
      if (assignment.readerId !== request.user!.id) {
        return reply.code(403).send({ code: "forbidden", message: "Cette mission n'est pas la vôtre." });
      }
      const job = await prisma.aiReadingJob.findFirst({
        where: { manuscriptId: assignment.manuscriptId, workType: "evaluation", status: "termine", reportText: { not: null } },
        orderBy: [{ finishedAt: "desc" }, { launchedAt: "desc" }],
        select: { reportText: true, finishedAt: true },
      });
      const scores = parseGrilleScores(job?.reportText);
      return reply.send({ available: scores.length > 0, scores, reportDate: job?.finishedAt ?? null });
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
            authorMessage: parsed.data.author_message?.trim() || null,
            authorPoints: parsed.data.author_points?.map((p) => p.trim()).filter((p) => p.length > 0) ?? undefined,
            scoreGapFlag,
          },
        });

        // Acceptation sous conditions (point n°2) : on enregistre les conditions
        // posées comme des éléments à lever, un par un, avant la production. Les
        // « points communicables » saisis par la Direction en tiennent lieu si la
        // liste dédiée n'est pas fournie (l'interface envoie les deux).
        if (parsed.data.decision === "acceptation_conditions") {
          const condLabels = (parsed.data.conditions?.length ? parsed.data.conditions : parsed.data.author_points ?? [])
            .map((c) => c.trim())
            .filter((c) => c.length > 0);
          if (condLabels.length > 0) {
            await tx.editorialAcceptanceCondition.createMany({
              data: condLabels.map((label) => ({ manuscriptId: id, decisionId: created.id, label, createdById: request.user!.id })),
            });
          }
        }

        // Décisions terminales (le dossier quitte l'étape « décision ») :
        // acceptation(s) → planification ; refus et refus avec resoumission →
        // archivage. « revision » et « attente » laissent le dossier OUVERT à
        // l'étape de décision (en attente d'une version révisée / d'un complément).
        const isTerminalDecision = ["acceptation", "acceptation_conditions", "refus", "refus_resoumission"].includes(parsed.data.decision);
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
          // une acceptation avance vers la PLANIFICATION du projet (étape 5).
          // Depuis D-010 (18/08/2026), la contractualisation n'est plus l'étape
          // qui suit la décision : elle a été déplacée juste après la validation
          // du BAT. La production démarre donc sur la planification.
          const nextCode = ["refus", "refus_resoumission"].includes(parsed.data.decision) ? "ARCHIVAGE" : "PLANIFICATION";
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

      // Réponse à l'auteur (audit éditorial, point n°1) : pour toute décision
      // terminale, on adresse une lettre à l'auteur (acceptation / sous
      // conditions / refus courtois), à partir de modèles éditables, et on trace
      // l'envoi sur la décision. Au meilleur effort : n'échoue jamais la décision.
      let authorNotifiedTo: string | null = null;
      if (LETTER_KEYS.includes(parsed.data.decision as EditorialLetterKey)) {
        try {
          const contributor = await prisma.workContributor.findFirst({
            where: { manuscriptId: id, role: "author" },
            include: { partner: { select: { firstName: true, lastName: true, email: true } } },
          });
          const email = contributor?.partner.email?.trim();
          if (email) {
            const key = parsed.data.decision as EditorialLetterKey;
            const templates = await resolveLetterTemplates();
            const maison = await houseName();
            // Points communicables : ceux saisis par la Direction ; à défaut, pour
            // une acceptation sous conditions, les conditions posées.
            const pointsList =
              parsed.data.author_points && parsed.data.author_points.length > 0
                ? parsed.data.author_points
                : key === "acceptation_conditions"
                  ? parsed.data.conditions ?? []
                  : [];
            const composed = composeLetter(templates[key], {
              auteur: `${contributor!.partner.firstName ?? ""} ${contributor!.partner.lastName ?? ""}`.trim(),
              titre: manuscript.title,
              numero: manuscript.manuscriptNumber,
              points: buildPointsBlock(key, pointsList),
              message: parsed.data.author_message?.trim() || "",
              date: new Date().toLocaleDateString("fr-FR"),
              maison,
            });
            const sender = senderIdentity(request.user!);
            // Cachet « Direction Éditoriale » apposé sur l'e-mail (non signé à la main).
            const cachet = (await getBranding()).cachet_editoriale;
            await sendMail({ to: email, subject: composed.subject, text: composed.textBody, html: letterEmailHtml(composed.layout, cachet), ...sender }).catch(() => false);
            authorNotifiedTo = email;
            await prisma.editorialDecision.update({ where: { id: decision.id }, data: { authorNotifiedTo: email, authorNotifiedAt: new Date() } });
          }
        } catch {
          /* l'envoi de la lettre ne doit jamais bloquer la décision */
        }
      }

      await writeAuditLog({
        userId: request.user!.id,
        action: "validate",
        entityType: "manuscript",
        entityId: id,
        newValues: { decision: parsed.data.decision, scoreGapFlag, author_notified_to: authorNotifiedTo, mail_configured: isMailConfigured() },
        ipAddress: request.ip,
      });

      return reply.code(201).send({ ...decision, authorNotifiedTo });
    },
  );

  // Modèles de lettres de décision (éditables). Lecture : éditorial ; édition :
  // administration (config à l'échelle de la maison).
  fastify.get("/api/v1/editorial-decision-letters", { preHandler: requirePermission("decision_editoriale", "consultation") }, async (_request, reply) => {
    return reply.send({
      templates: await resolveLetterTemplates(),
      keys: LETTER_KEYS,
      labels: LETTER_LABELS,
      defaults: DEFAULT_LETTERS,
      placeholders: ["{{auteur}}", "{{titre}}", "{{numero}}", "{{genre}}", "{{date}}", "{{points}}", "{{message}}", "{{maison}}"],
    });
  });

  fastify.put("/api/v1/editorial-decision-letters", { preHandler: requirePermission("manuscripts", "administration") }, async (request, reply) => {
    const tpl = z.object({ subject: z.string().min(1).max(300), body: z.string().min(1).max(8000) });
    const parsed = z
      .object({
        acceptation: tpl.optional(),
        acceptation_conditions: tpl.optional(),
        revision: tpl.optional(),
        refus: tpl.optional(),
        refus_resoumission: tpl.optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    await prisma.setting.upsert({ where: { key: "editorial_decision_letters" }, update: { value: parsed.data }, create: { key: "editorial_decision_letters", value: parsed.data } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "setting", entityId: "editorial_decision_letters", ipAddress: request.ip });
    return reply.send({ ok: true, templates: await resolveLetterTemplates() });
  });

  // Règles « comité professionnel » (audit éditorial, point n°3) : quorum de
  // lecteurs + déclaration de conflit d'intérêt, activables au choix. Lecture :
  // comité ; édition : administration.
  fastify.get("/api/v1/reading-committee-rules", { preHandler: requirePermission("comite_lecture", "consultation") }, async (_request, reply) => {
    return reply.send({ rules: await readingCommitteeRules(), defaults: DEFAULT_READING_COMMITTEE_RULES });
  });

  fastify.put("/api/v1/reading-committee-rules", { preHandler: requirePermission("manuscripts", "administration") }, async (request, reply) => {
    const parsed = z
      .object({ quorumEnabled: z.boolean(), quorum: z.number().int().min(1).max(10), conflictEnabled: z.boolean() })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    await prisma.setting.upsert({ where: { key: READING_COMMITTEE_RULES_KEY }, update: { value: parsed.data }, create: { key: READING_COMMITTEE_RULES_KEY, value: parsed.data } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "setting", entityId: READING_COMMITTEE_RULES_KEY, newValues: parsed.data, ipAddress: request.ip });
    return reply.send({ ok: true, rules: await readingCommitteeRules() });
  });

  // Aperçu / réimpression de la lettre de la dernière décision d'un manuscrit.
  fastify.get("/api/v1/manuscripts/:id/decision-letter", { preHandler: requirePermission("decision_editoriale", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const decision = await prisma.editorialDecision.findFirst({ where: { manuscriptId: id }, orderBy: { decidedAt: "desc" } });
    if (!decision) return reply.code(404).send({ code: "not_found", message: "Aucune décision pour ce manuscrit." });
    if (!LETTER_KEYS.includes(decision.decision as EditorialLetterKey)) {
      return reply.code(409).send({ code: "no_letter", message: "Cette décision ne donne pas lieu à une lettre à l'auteur." });
    }
    const key = decision.decision as EditorialLetterKey;
    const m = await prisma.manuscript.findUniqueOrThrow({ where: { id }, select: { title: true, manuscriptNumber: true } });
    const contributor = await prisma.workContributor.findFirst({ where: { manuscriptId: id, role: "author" }, include: { partner: { select: { firstName: true, lastName: true, email: true } } } });
    const templates = await resolveLetterTemplates();
    const maison = await houseName();
    // Points communicables mémorisés sur la décision (repli : conditions posées).
    let pointsList = Array.isArray(decision.authorPoints) ? (decision.authorPoints as string[]) : [];
    if (pointsList.length === 0 && key === "acceptation_conditions") {
      const conds = await prisma.editorialAcceptanceCondition.findMany({ where: { decisionId: decision.id, deletedAt: null }, select: { label: true } });
      pointsList = conds.map((c) => c.label);
    }
    const composed = composeLetter(templates[key], {
      auteur: `${contributor?.partner.firstName ?? ""} ${contributor?.partner.lastName ?? ""}`.trim() || "l'auteur",
      titre: m.title,
      numero: m.manuscriptNumber,
      points: buildPointsBlock(key, pointsList),
      message: decision.authorMessage ?? "",
      date: decision.decidedAt.toLocaleDateString("fr-FR"),
      maison,
    });
    return reply.send({ decision: decision.decision, subject: composed.subject, body: composed.textBody, layout: composed.layout, author_email: contributor?.partner.email ?? null, notified_at: decision.authorNotifiedAt, notified_to: decision.authorNotifiedTo });
  });

  // Aperçu de la lettre pour la décision EN COURS de saisie (avant enregistrement) :
  // permet à la Direction de vérifier que la lettre correspond bien à la décision
  // sélectionnée et à ses éléments communicables. Ne modifie rien.
  fastify.post("/api/v1/manuscripts/:id/decision-letter/preview", { preHandler: requirePermission("decision_editoriale", "validation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        decision: z.nativeEnum(EditorialDecisionType),
        author_message: z.string().max(4000).optional(),
        author_points: z.array(z.string().min(1).max(500)).max(20).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const key = parsed.data.decision as EditorialLetterKey;
    if (!LETTER_KEYS.includes(key)) {
      return reply.code(409).send({ code: "no_letter", message: "Cette décision ne donne pas lieu à une lettre à l'auteur (aucun aperçu)." });
    }
    const m = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, select: { title: true, manuscriptNumber: true } });
    if (!m) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
    const contributor = await prisma.workContributor.findFirst({ where: { manuscriptId: id, role: "author" }, include: { partner: { select: { firstName: true, lastName: true } } } });
    const templates = await resolveLetterTemplates();
    const maison = await houseName();
    const composed = composeLetter(templates[key], {
      auteur: `${contributor?.partner.firstName ?? ""} ${contributor?.partner.lastName ?? ""}`.trim() || "l'auteur",
      titre: m.title,
      numero: m.manuscriptNumber,
      points: buildPointsBlock(key, parsed.data.author_points ?? []),
      message: parsed.data.author_message?.trim() || "",
      date: new Date().toLocaleDateString("fr-FR"),
      maison,
    });
    return reply.send({ decision: key, subject: composed.subject, body: composed.textBody, layout: composed.layout });
  });

  // === Suivi des acceptations « sous conditions » (audit éditorial, point n°2) ===
  // Les conditions posées par le comité sont listées, puis « levées » (datées,
  // tracées) au fur et à mesure. Le passage en mise en page (production) est
  // bloqué tant qu'il en reste (contrôle dans workflow.ts).

  // Résout les noms des auteurs de dépôt/levée pour l'affichage.
  async function decorateConditions(rows: { createdById: string; liftedById: string | null }[]) {
    const ids = [...new Set(rows.flatMap((r) => [r.createdById, r.liftedById]).filter((v): v is string => !!v))];
    const users = ids.length
      ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, employee: { select: { firstName: true, lastName: true } } } })
      : [];
    const byId = new Map(users.map((u) => [u.id, `${u.employee?.firstName ?? ""} ${u.employee?.lastName ?? ""}`.trim() || u.username]));
    return byId;
  }

  fastify.get("/api/v1/manuscripts/:id/acceptance-conditions", { preHandler: requirePermission("decision_editoriale", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [rows, lastDecision] = await Promise.all([
      prisma.editorialAcceptanceCondition.findMany({ where: { manuscriptId: id, deletedAt: null }, orderBy: { createdAt: "asc" } }),
      prisma.editorialDecision.findFirst({ where: { manuscriptId: id }, orderBy: { decidedAt: "desc" }, select: { decision: true } }),
    ]);
    const names = await decorateConditions(rows);
    const items = rows.map((r) => ({
      id: r.id,
      label: r.label,
      created_at: r.createdAt,
      created_by: names.get(r.createdById) ?? null,
      lifted: !!r.liftedAt,
      lifted_at: r.liftedAt,
      lifted_by: r.liftedById ? names.get(r.liftedById) ?? null : null,
      lift_note: r.liftNote,
    }));
    const remaining = items.filter((i) => !i.lifted).length;
    return reply.send({ items, total: items.length, lifted: items.length - remaining, remaining, conditional: lastDecision?.decision === "acceptation_conditions" });
  });

  // Ajoute une condition à l'acceptation sous conditions en cours.
  fastify.post("/api/v1/manuscripts/:id/acceptance-conditions", { preHandler: requirePermission("decision_editoriale", "validation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ label: z.string().min(1).max(500) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Intitulé de condition manquant." });
    const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
    if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
    const decision = await prisma.editorialDecision.findFirst({ where: { manuscriptId: id }, orderBy: { decidedAt: "desc" } });
    if (!decision || decision.decision !== "acceptation_conditions") {
      return reply.code(409).send({ code: "not_conditional", message: "La dernière décision de ce manuscrit n'est pas une acceptation sous conditions." });
    }
    const created = await prisma.editorialAcceptanceCondition.create({
      data: { manuscriptId: id, decisionId: decision.id, label: parsed.data.label.trim(), createdById: request.user!.id },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "editorial_acceptance_condition", entityId: created.id, newValues: { manuscript_id: id, label: created.label }, ipAddress: request.ip });
    return reply.code(201).send({ id: created.id, label: created.label });
  });

  // Lève une condition (elle est remplie) — datée et tracée.
  fastify.post("/api/v1/acceptance-conditions/:condId/lift", { preHandler: requirePermission("decision_editoriale", "validation") }, async (request, reply) => {
    const { condId } = request.params as { condId: string };
    const parsed = z.object({ note: z.string().max(1000).optional() }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides." });
    const cond = await prisma.editorialAcceptanceCondition.findFirst({ where: { id: condId, deletedAt: null } });
    if (!cond) return reply.code(404).send({ code: "not_found", message: "Condition introuvable." });
    if (cond.liftedAt) return reply.code(409).send({ code: "already_lifted", message: "Cette condition est déjà levée." });
    await prisma.editorialAcceptanceCondition.update({ where: { id: condId }, data: { liftedAt: new Date(), liftedById: request.user!.id, liftNote: parsed.data.note?.trim() || null } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "editorial_acceptance_condition", entityId: condId, newValues: { lifted: true, note: parsed.data.note ?? null }, ipAddress: request.ip });
    return reply.send({ ok: true });
  });

  // Rouvre une condition levée par erreur (règle d'or : réversible, tracé).
  fastify.post("/api/v1/acceptance-conditions/:condId/reopen", { preHandler: requirePermission("decision_editoriale", "validation") }, async (request, reply) => {
    const { condId } = request.params as { condId: string };
    const cond = await prisma.editorialAcceptanceCondition.findFirst({ where: { id: condId, deletedAt: null } });
    if (!cond) return reply.code(404).send({ code: "not_found", message: "Condition introuvable." });
    if (!cond.liftedAt) return reply.code(409).send({ code: "not_lifted", message: "Cette condition n'est pas levée." });
    await prisma.editorialAcceptanceCondition.update({ where: { id: condId }, data: { liftedAt: null, liftedById: null, liftNote: null } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "editorial_acceptance_condition", entityId: condId, newValues: { lifted: false }, ipAddress: request.ip });
    return reply.send({ ok: true });
  });

  // Retire une condition ajoutée par erreur (suppression logique, Modèle §13).
  fastify.delete("/api/v1/acceptance-conditions/:condId", { preHandler: requirePermission("decision_editoriale", "validation") }, async (request, reply) => {
    const { condId } = request.params as { condId: string };
    const cond = await prisma.editorialAcceptanceCondition.findFirst({ where: { id: condId, deletedAt: null } });
    if (!cond) return reply.code(404).send({ code: "not_found", message: "Condition introuvable." });
    await prisma.editorialAcceptanceCondition.update({ where: { id: condId }, data: { deletedAt: new Date() } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "editorial_acceptance_condition", entityId: condId, newValues: { deleted: true }, ipAddress: request.ip });
    return reply.send({ ok: true });
  });
}

async function completeReadingCommitteeStep(manuscriptId: string, userId: string): Promise<boolean> {
  const comiteStatus = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "COMITE_LECTURE" } });
  const decisionStatus = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "DECISION_EDITORIALE" } });
  const now = new Date();

  // Garde-fou : ne transmettre que si le manuscrit est encore au comité de
  // lecture (évite un double passage si l'étape a déjà avancé).
  const current = await prisma.manuscript.findUniqueOrThrow({ where: { id: manuscriptId }, select: { statusId: true } });
  if (current.statusId !== comiteStatus.id) return false;

  // Quorum (audit éditorial, point n°3), si activé : ne transmettre à la
  // Direction éditoriale qu'une fois le nombre minimal de rapports remis
  // atteint. Sinon le dossier reste au comité — le coordinateur peut alors
  // affecter d'autres lecteurs (aucun blocage définitif). Désactivé par
  // défaut : un seul rapport suffit, comme aujourd'hui.
  const rules = await readingCommitteeRules();
  if (rules.quorumEnabled) {
    const submitted = await prisma.readingAssignment.count({ where: { manuscriptId, status: "submitted" } });
    if (submitted < rules.quorum) return false;
  }

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
