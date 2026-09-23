import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAnyRole, requirePermission, requireAnyPermission } from "../lib/permissions.js";
import { startAiReading, executeAiReading, AiRunError, extractAnomaliesForJob } from "../lib/aiRunner.js";
import { SUPPORTS } from "../lib/correctionProfile.js";
import { isAnomalyStatus } from "../lib/correctionAnomalies.js";
import { writeAuditLog } from "../lib/audit.js";
import { isDirection } from "../lib/stepDocuments.js";
import {
  loadConfig,
  saveConfig,
  publicView,
  applyApiKey,
  readApiKey,
  resolveModelId,
  MODEL_PRESETS,
  WORK_TYPES,
  CONFIDENTIALITY_LEVELS,
  type AiEditorialConfig,
} from "../lib/aiConfig.js";

// IA éditoriale — Lot IA-0 : configuration (compte/clé/modèles) et bibliothèque
// de prompts. Aucun manuscrit n'est analysé ici ; ce lot pose les fondations.
// La clé API n'est jamais renvoyée en clair (vue masquée seulement).

// La configuration du compte/clé est la plus sensible (facturation) : réservée
// à l'administration générale. L'édition des prompts relève de l'administration
// éditoriale.
const CONFIG_ROLES = ["ADMIN_GENERAL", "DIR_GENERAL"];

const presetEnum = z.enum(["leger", "intermediaire", "premium"]);

const configSchema = z.object({
  enabled: z.boolean(),
  account_label: z.string().trim().max(120).optional().default(""),
  models: z.object({
    evaluation: presetEnum,
    correction_1: presetEnum,
    correction_2: presetEnum,
    couverture: presetEnum,
    expertise: presetEnum,
    reecriture: presetEnum,
  }),
  allowed_confidentiality: z.array(z.enum(CONFIDENTIALITY_LEVELS)).min(1),
  // Clé API : facultative à la mise à jour. Fournie → chiffrée ; chaîne vide →
  // effacée ; absente → inchangée.
  api_key: z.string().optional(),
});

const promptSchema = z.object({
  label: z.string().trim().min(1).max(160),
  system_prompt: z.string().trim().min(1),
  user_template: z.string().trim().min(1),
  report_template: z.any(),
});

// Porte de LECTURE des relectures IA (journal, rapport, comparaison, livrables).
// Ouverte à qui peut consulter les manuscrits / le comité de lecture, ET au
// correcteur désigné (droit « tâches ») : il récupère les analyses lancées
// depuis SA boîte « Mes corrections », là où il les a déclenchées, sans exiger
// le droit large « documents » (la GED reste réservée). Le contrôle par
// permission suffit — même posture que le reste du module.
const AI_JOB_READ_PERMS = [
  { module: "comite_lecture" as const, action: "consultation" as const },
  { module: "manuscripts" as const, action: "consultation" as const },
  { module: "tasks" as const, action: "consultation" as const },
];

// Permissions autorisant le lancement — et donc l'ARRÊT — d'une relecture IA.
const AI_JOB_LAUNCH_PERMS = [
  { module: "comite_lecture" as const, action: "saisie" as const },
  { module: "manuscripts" as const, action: "validation" as const },
  { module: "manuscripts" as const, action: "saisie" as const },
  { module: "manuscripts" as const, action: "administration" as const },
  { module: "tasks" as const, action: "saisie" as const },
  { module: "bat" as const, action: "saisie" as const },
];

// Un lancement IA tourne EN ARRIÈRE-PLAN : si le conteneur redémarre (déploiement)
// ou si l'appel est interrompu, le job pouvait rester « en cours » indéfiniment
// (statut jamais résolu → l'opérateur relançait, consommant du crédit). Balayage
// paresseux : au-delà de ce délai sans conclusion, un job « en cours » est
// considéré comme interrompu et marqué en erreur (résolu, non bloquant).
const AI_JOB_STALE_MINUTES = 15;
async function sweepStaleAiJobs(manuscriptId?: string): Promise<void> {
  const cutoff = new Date(Date.now() - AI_JOB_STALE_MINUTES * 60 * 1000);
  await prisma.aiReadingJob
    .updateMany({
      where: { status: { in: ["en_cours", "en_attente"] }, launchedAt: { lt: cutoff }, ...(manuscriptId ? { manuscriptId } : {}) },
      data: { status: "erreur", finishedAt: new Date(), errorMessage: `Lancement interrompu (aucune réponse après ${AI_JOB_STALE_MINUTES} min — souvent un redémarrage du serveur). Relancez si besoin.` },
    })
    .catch(() => {});
}

// L'INFOGRAPHE qui intègre les corrections de COUVERTURE : celui DÉSIGNÉ pour
// l'ouvrage (rubrique « correction de couverture ») en priorité, sinon le
// responsable de l'étape Infographie.
async function manuscriptInfographeId(manuscriptId: string): Promise<string | null> {
  const m = await prisma.manuscript.findUnique({ where: { id: manuscriptId }, select: { coverIntegratorId: true } });
  if (m?.coverIntegratorId) return m.coverIntegratorId;
  const step = await prisma.manuscriptStep.findFirst({
    where: { manuscriptId, status: { code: "INFOGRAPHIE" } },
    orderBy: { createdAt: "desc" },
    select: { responsibleId: true },
  });
  return step?.responsibleId ?? null;
}

export default async function aiEditorialRoutes(fastify: FastifyInstance) {
  // — Configuration —
  fastify.get("/api/v1/ai-editorial/config", { preHandler: requireAnyRole(CONFIG_ROLES) }, async (_request, reply) => {
    const cfg = await loadConfig();
    return reply.send(publicView(cfg));
  });

  fastify.put("/api/v1/ai-editorial/config", { preHandler: requireAnyRole(CONFIG_ROLES) }, async (request, reply) => {
    const parsed = configSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "invalid_body", message: "Configuration invalide.", details: parsed.error.flatten() });
    }
    const current = await loadConfig();
    let next: AiEditorialConfig = {
      ...current,
      enabled: parsed.data.enabled,
      accountLabel: parsed.data.account_label ?? "",
      models: parsed.data.models as AiEditorialConfig["models"],
      allowedConfidentiality: [...parsed.data.allowed_confidentiality],
    };
    if (parsed.data.api_key !== undefined) {
      next = applyApiKey(next, parsed.data.api_key);
    }
    await saveConfig(next, request.user!.id);
    // Journalisé sans jamais écrire la clé (append-only, modèle §3.6).
    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "ai_editorial_config",
      entityId: "singleton",
      newValues: { enabled: next.enabled, accountLabel: next.accountLabel, models: next.models, apiKeyChanged: parsed.data.api_key !== undefined },
      ipAddress: request.ip,
    });
    return reply.send(publicView(next));
  });

  // — Test de connexion : petit appel réel à l'API Claude avec la clé stockée —
  fastify.post("/api/v1/ai-editorial/test-connection", { preHandler: requireAnyRole(CONFIG_ROLES) }, async (_request, reply) => {
    const cfg = await loadConfig();
    const apiKey = readApiKey(cfg);
    if (!apiKey) {
      return reply.code(400).send({ code: "no_api_key", message: "Aucune clé API configurée. Saisissez d'abord une clé, puis testez la connexion." });
    }
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey });
      const res = await client.messages.create({
        model: resolveModelId(cfg.models.evaluation),
        max_tokens: 8,
        messages: [{ role: "user", content: "ping" }],
      });
      return reply.send({ ok: true, model: res.model });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Connexion impossible.";
      return reply.code(502).send({ code: "connection_failed", message: `Connexion à l'API Claude impossible : ${message}` });
    }
  });

  // — Bibliothèque de prompts —
  fastify.get("/api/v1/ai-editorial/prompts", { preHandler: requirePermission("manuscripts", "administration") }, async (_request, reply) => {
    const prompts = await prisma.aiPrompt.findMany({ orderBy: { workType: "asc" } });
    return reply.send({ prompts, work_types: WORK_TYPES, model_presets: MODEL_PRESETS });
  });

  fastify.put("/api/v1/ai-editorial/prompts/:workType", { preHandler: requirePermission("manuscripts", "administration") }, async (request, reply) => {
    const { workType } = request.params as { workType: string };
    if (!WORK_TYPES.includes(workType as (typeof WORK_TYPES)[number])) {
      return reply.code(404).send({ code: "unknown_work_type", message: "Type de travail inconnu." });
    }
    const parsed = promptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "invalid_body", message: "Prompt invalide.", details: parsed.error.flatten() });
    }
    const existing = await prisma.aiPrompt.findUnique({ where: { workType: workType as never } });
    const updated = await prisma.aiPrompt.upsert({
      where: { workType: workType as never },
      update: {
        label: parsed.data.label,
        systemPrompt: parsed.data.system_prompt,
        userTemplate: parsed.data.user_template,
        reportTemplate: parsed.data.report_template,
        version: (existing?.version ?? 0) + 1,
        updatedBy: request.user!.id,
      },
      create: {
        workType: workType as never,
        label: parsed.data.label,
        systemPrompt: parsed.data.system_prompt,
        userTemplate: parsed.data.user_template,
        reportTemplate: parsed.data.report_template,
        version: 1,
        updatedBy: request.user!.id,
      },
    });
    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "ai_prompt",
      entityId: updated.id,
      newValues: { workType, version: updated.version },
      ipAddress: request.ip,
    });
    return reply.send(updated);
  });

  // — Moteur de correction éditoriale : paramétrage (types d'ouvrage + supports +
  // grilles de contrôle). La LECTURE des types/supports sert aux sélecteurs de
  // l'écran de correction (accessible au correcteur : droit « tâches »).
  fastify.get(
    "/api/v1/ai-editorial/book-types",
    { preHandler: requireAnyPermission(AI_JOB_READ_PERMS) },
    async (_request, reply) => {
      const bookTypes = await prisma.bookType.findMany({ where: { isActive: true }, orderBy: [{ displayOrder: "asc" }, { label: "asc" }], select: { code: true, label: true } });
      return reply.send({ book_types: bookTypes, supports: SUPPORTS });
    },
  );

  // Grilles de correction (tous les profils + points) — pour l'écran de paramétrage.
  fastify.get(
    "/api/v1/ai-editorial/correction-profiles",
    { preHandler: requirePermission("manuscripts", "administration") },
    async (_request, reply) => {
      const [bookTypes, profiles] = await Promise.all([
        prisma.bookType.findMany({ orderBy: [{ displayOrder: "asc" }, { label: "asc" }] }),
        prisma.correctionProfile.findMany({ orderBy: { label: "asc" }, include: { controlPoints: { orderBy: [{ displayOrder: "asc" }, { label: "asc" }] } } }),
      ]);
      return reply.send({ book_types: bookTypes, supports: SUPPORTS, profiles, severities: ["C1", "C2", "C3", "S"] });
    },
  );

  // Créer / renommer / (dés)activer un type d'ouvrage (paramétrage éditable).
  const bookTypeSchema = z.object({ label: z.string().trim().min(1).max(120), display_order: z.number().int().optional(), is_active: z.boolean().optional() });
  fastify.put(
    "/api/v1/ai-editorial/book-types/:code",
    { preHandler: requirePermission("manuscripts", "administration") },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      if (!/^[a-z0-9_]{2,60}$/.test(code)) return reply.code(400).send({ code: "invalid_code", message: "Code de type invalide (lettres minuscules, chiffres, tirets bas)." });
      const parsed = bookTypeSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "invalid_body", message: "Type d'ouvrage invalide.", details: parsed.error.flatten() });
      const bt = await prisma.bookType.upsert({
        where: { code },
        update: { label: parsed.data.label, displayOrder: parsed.data.display_order ?? undefined, isActive: parsed.data.is_active ?? undefined, updatedBy: request.user!.id },
        create: { code, label: parsed.data.label, displayOrder: parsed.data.display_order ?? 0, isActive: parsed.data.is_active ?? true, updatedBy: request.user!.id },
      });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "book_type", entityId: bt.id, newValues: { code, label: bt.label }, ipAddress: request.ip });
      return reply.send({ ok: true });
    },
  );

  // Remplacer la GRILLE de correction d'un type (points de contrôle) — édition
  // atomique. book_type_code = "__defaut__" pour la grille par défaut.
  const profileSchema = z.object({
    label: z.string().trim().min(1).max(160),
    points: z.array(z.object({ label: z.string().trim().min(1).max(300), default_severity: z.enum(["C1", "C2", "C3", "S"]).default("C3"), is_active: z.boolean().optional() })).max(200),
  });
  fastify.put(
    "/api/v1/ai-editorial/correction-profiles/:code",
    { preHandler: requirePermission("manuscripts", "administration") },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      if (!/^[a-z0-9_]{2,60}$/.test(code)) return reply.code(400).send({ code: "invalid_code", message: "Code de type invalide." });
      const parsed = profileSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "invalid_body", message: "Grille invalide.", details: parsed.error.flatten() });
      await prisma.$transaction(async (tx) => {
        const profile = await tx.correctionProfile.upsert({
          where: { bookTypeCode: code },
          update: { label: parsed.data.label, updatedBy: request.user!.id },
          create: { bookTypeCode: code, label: parsed.data.label, updatedBy: request.user!.id },
        });
        await tx.correctionControlPoint.deleteMany({ where: { profileId: profile.id } });
        if (parsed.data.points.length) {
          await tx.correctionControlPoint.createMany({
            data: parsed.data.points.map((p, i) => ({ profileId: profile.id, label: p.label, defaultSeverity: p.default_severity, displayOrder: i, isActive: p.is_active ?? true })),
          });
        }
        await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "correction_profile", entityId: profile.id, newValues: { code, points: parsed.data.points.length }, ipAddress: request.ip });
      });
      return reply.send({ ok: true });
    },
  );

  // — Lancement d'une relecture IA (Lot IA-1) —
  const runSchema = z.object({
    manuscript_id: z.string().uuid(),
    work_type: z.enum(WORK_TYPES),
    step_code: z.string().max(40).optional(),
    editor_recommendation: z.string().max(4000).optional(),
    // Passage BAT (couverture) : BAT1 = 1ᵉʳ passage, BAT2 = 2ᵉ passage (suivi
    // des corrections du BAT précédent, transmis automatiquement à l'IA).
    cover_pass: z.enum(["BAT1", "BAT2"]).optional(),
    // Évaluation : type de manuscrit choisi par le relecteur pour adapter la
    // grille transmise à l'IA (sinon : domaine de l'ouvrage).
    grid_genre_id: z.string().uuid().nullable().optional(),
    // Moteur de correction éditoriale : type d'ouvrage (charge la grille de
    // contrôle) et support analysé. Facultatifs (repli sur la grille par défaut).
    book_type_code: z.string().max(60).nullable().optional(),
    support: z.string().max(60).nullable().optional(),
  });
  fastify.post(
    "/api/v1/ai-editorial/run",
    { preHandler: requireAnyPermission([
      { module: "comite_lecture", action: "saisie" },
      { module: "manuscripts", action: "validation" },
      { module: "manuscripts", action: "saisie" },
      { module: "manuscripts", action: "administration" },
      { module: "tasks", action: "saisie" },
      { module: "bat", action: "saisie" },
    ]) },
    async (request, reply) => {
      const parsed = runSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "invalid_body", message: "Requête invalide.", details: parsed.error.flatten() });
      }
      try {
        const runParams = {
          manuscriptId: parsed.data.manuscript_id,
          workType: parsed.data.work_type,
          editorRecommendation: parsed.data.editor_recommendation,
          stepCode: parsed.data.step_code,
          coverPass: parsed.data.cover_pass,
          gridGenreId: parsed.data.grid_genre_id ?? undefined,
          bookTypeCode: parsed.data.book_type_code ?? undefined,
          support: parsed.data.support ?? undefined,
          userId: request.user!.id,
          ip: request.ip,
        };
        // Pré-vol synchrone (validation + création du job) : les erreurs de
        // configuration reviennent tout de suite. L'analyse (longue) part ensuite
        // EN ARRIÈRE-PLAN — la requête répond aussitôt (fin des erreurs 504).
        const { jobId } = await startAiReading(runParams);
        void executeAiReading(jobId, runParams).catch(() => {
          /* l'échec éventuel est déjà consigné sur le job (statut « erreur ») */
        });
        return reply.code(202).send({ jobId, started: true });
      } catch (e) {
        if (e instanceof AiRunError) {
          const status = e.code === "not_found" || e.code === "no_manuscript_file" || e.code === "no_prompt" ? 404 : e.code === "ai_disabled" || e.code === "no_api_key" ? 400 : 502;
          return reply.code(status).send({ code: e.code, message: e.message });
        }
        return reply.code(500).send({ code: "run_failed", message: e instanceof Error ? e.message : "Échec." });
      }
    },
  );

  // — Journal des relectures IA d'un manuscrit (traçabilité + progression) —
  fastify.get(
    "/api/v1/ai-editorial/jobs",
    { preHandler: requireAnyPermission(AI_JOB_READ_PERMS) },
    async (request, reply) => {
      const manuscriptId = (request.query as { manuscript?: string }).manuscript;
      if (!manuscriptId) return reply.code(400).send({ code: "manuscript_required", message: "Paramètre « manuscript » requis." });
      // Résout d'abord les lancements restés « en cours » anormalement longtemps
      // (serveur redémarré, appel interrompu) pour que l'historique n'affiche
      // jamais un « en cours » perpétuel.
      await sweepStaleAiJobs(manuscriptId);
      const jobs = await prisma.aiReadingJob.findMany({ where: { manuscriptId }, orderBy: { launchedAt: "desc" } });
      // Signale au lanceur qu'un rapport est téléchargeable (1er document produit).
      const withReport = jobs.map((j) => ({
        ...j,
        reportAvailable: j.status === "termine" && Array.isArray(j.producedDocumentIds) && (j.producedDocumentIds as unknown[]).length > 0,
      }));
      return reply.send({ jobs: withReport });
    },
  );

  // — Arrêt d'un lancement IA (bouton « Stopper ») : l'opérateur interrompt une
  // relecture qui ne lui convient plus ou qui traîne. On marque le job « annulé »
  // s'il est encore en attente / en cours (l'appel IA en arrière-plan, s'il se
  // termine tard, ne réécrira pas un job annulé — cf. garde dans aiRunner). —
  fastify.post(
    "/api/v1/ai-editorial/jobs/:jobId/cancel",
    { preHandler: requireAnyPermission(AI_JOB_LAUNCH_PERMS) },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string };
      const job = await prisma.aiReadingJob.findUnique({ where: { id: jobId } });
      if (!job) return reply.code(404).send({ code: "not_found", message: "Relecture introuvable." });
      if (job.status !== "en_cours" && job.status !== "en_attente") {
        return reply.code(409).send({ code: "not_cancellable", message: "Ce lancement est déjà terminé (ou arrêté) : il n'y a rien à interrompre." });
      }
      const done = await prisma.aiReadingJob.updateMany({
        where: { id: jobId, status: { in: ["en_cours", "en_attente"] } },
        data: { status: "annule", finishedAt: new Date(), errorMessage: "Lancement arrêté par l'opérateur." },
      });
      if (done.count === 0) {
        return reply.code(409).send({ code: "not_cancellable", message: "Le lancement vient de se terminer : rien à interrompre." });
      }
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "ai_reading_job", entityId: jobId, oldValues: { status: job.status }, newValues: { status: "annule" }, ipAddress: request.ip });
      return reply.send({ ok: true });
    },
  );

  // — Téléchargement du rapport produit par une relecture IA —
  // Volontairement accessible à quiconque peut consulter les relectures IA (même
  // porte que la liste ci-dessus) : le lecteur ou le correcteur récupère SON
  // rapport là où il l'a lancé, SANS exiger le droit « documents : consultation »
  // (la GED reste réservée). Le rapport est le 1er document produit par le job.
  fastify.get(
    "/api/v1/ai-editorial/jobs/:jobId/report",
    { preHandler: requireAnyPermission(AI_JOB_READ_PERMS) },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string };
      const job = await prisma.aiReadingJob.findUnique({ where: { id: jobId } });
      if (!job) return reply.code(404).send({ code: "not_found", message: "Relecture introuvable." });
      const produced = Array.isArray(job.producedDocumentIds) ? (job.producedDocumentIds as string[]) : [];
      if (job.status !== "termine" || produced.length === 0) {
        return reply.code(404).send({ code: "no_report", message: "Aucun rapport n'est encore disponible pour cette relecture." });
      }
      const mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      // Choix d'impression : avec (entete=1) ou sans (entete=0) en-tête maison.
      // Par défaut, SANS en-tête — cohérent avec le rapport déposé (le mode par
      // défaut est « tel quel »). On régénère le .docx depuis le texte source
      // conservé sur le job ; à défaut (anciens jobs), on sert le .docx classé.
      const enteteParam = (request.query as { entete?: string }).entete;
      const wantEntete = enteteParam === "1" || enteteParam === "true";
      if (job.reportText) {
        const prompt = await prisma.aiPrompt.findUnique({ where: { workType: job.workType } });
        const reportTitle = String((prompt?.reportTemplate as { title?: string })?.title ?? "RAPPORT");
        const { renderReportDocx } = await import("../lib/aiRunner.js");
        const buffer = await renderReportDocx(reportTitle, job.reportText, { entete: wantEntete });
        const fileName = `rapport_${job.workType}${wantEntete ? "_entete" : ""}.docx`;
        reply.header("content-type", mime);
        reply.header("content-disposition", `attachment; filename="${fileName}"`);
        return reply.send(buffer);
      }
      // Repli (jobs antérieurs sans texte conservé) : le .docx classé (avec en-tête).
      const version = await prisma.documentVersion.findFirst({
        where: { document: { id: produced[0] } },
        orderBy: { versionNumber: "desc" },
      });
      if (!version) return reply.code(404).send({ code: "no_report", message: "Le rapport de cette relecture est introuvable." });
      const { readStoredFile } = await import("../lib/storage.js");
      const buffer = await readStoredFile(version.filePath);
      const fileName = `rapport_${job.workType}.docx`;
      reply.header("content-type", version.mimeType);
      reply.header("content-disposition", `attachment; filename="${fileName}"`);
      return reply.send(buffer);
    },
  );

  // — Comparaison avant/après d'une réécriture IA —
  // Renvoie le texte source analysé et le texte réécrit proposé, pour un affichage
  // « version originale / version proposée ». Même porte que le rapport.
  fastify.get(
    "/api/v1/ai-editorial/jobs/:jobId/comparison",
    { preHandler: requireAnyPermission(AI_JOB_READ_PERMS) },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string };
      const job = await prisma.aiReadingJob.findUnique({ where: { id: jobId }, select: { workType: true, sourceText: true, rewriteText: true } });
      if (!job) return reply.code(404).send({ code: "not_found", message: "Relecture introuvable." });
      if (job.workType !== "reecriture" || !job.sourceText || !job.rewriteText) {
        return reply.code(404).send({ code: "no_comparison", message: "Aucune comparaison avant/après n'est disponible pour cette relecture." });
      }
      return reply.send({ original: job.sourceText, rewritten: job.rewriteText });
    },
  );

  const READ_JOB_PERMS = AI_JOB_READ_PERMS;

  // — Anomalies de correction (Lot 3) : validation humaine ligne par ligne —
  // Droit d'AGIR sur une anomalie (accepter/modifier/rejeter/à vérifier) : le
  // correcteur/intégrateur (tâches) ou la Direction éditoriale (validation).
  const ANOMALY_WRITE_PERMS = [
    { module: "tasks" as const, action: "saisie" as const },
    { module: "manuscripts" as const, action: "validation" as const },
    { module: "manuscripts" as const, action: "administration" as const },
  ];

  // Liste des anomalies d'un ouvrage (toutes relectures confondues), avec un
  // récapitulatif par statut. Groupables côté écran par relecture (jobId).
  fastify.get(
    "/api/v1/manuscripts/:id/correction-anomalies",
    { preHandler: requireAnyPermission(AI_JOB_READ_PERMS) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const jobFilter = (request.query as { job?: string }).job;
      const anomalies = await prisma.correctionAnomaly.findMany({
        where: { manuscriptId: id, ...(jobFilter ? { jobId: jobFilter } : {}) },
        orderBy: [{ createdAt: "desc" }, { number: "asc" }],
        include: { job: { select: { id: true, workType: true, launchedAt: true } } },
      });
      const peopleIds = [...new Set(anomalies.flatMap((a) => [a.decidedById, a.integratedById]).filter((v): v is string => Boolean(v)))];
      const users = peopleIds.length ? await prisma.user.findMany({ where: { id: { in: peopleIds } }, select: { id: true, username: true } }) : [];
      const nameById = new Map(users.map((u) => [u.id, u.username]));
      const summary = { total: anomalies.length, a_traiter: 0, acceptee: 0, modifiee: 0, rejetee: 0, a_verifier: 0 } as Record<string, number>;
      for (const a of anomalies) summary[a.status] = (summary[a.status] ?? 0) + 1;
      // Compteurs d'INTÉGRATION (2ᵉ temps) : seules les anomalies acceptées ou
      // modifiées se comptent (les autres n'ont rien à intégrer).
      const integration = { a_integrer: 0, integree: 0, a_revoir: 0, non_applicable: 0 } as Record<string, number>;
      for (const a of anomalies) {
        if (a.status === "acceptee" || a.status === "modifiee") integration[a.integrationStatus] = (integration[a.integrationStatus] ?? 0) + 1;
      }
      return reply.send({
        summary,
        integration,
        anomalies: anomalies.map((a) => ({
          id: a.id, job_id: a.jobId, work_type: a.job.workType, job_launched_at: a.job.launchedAt,
          number: a.number, severity: a.severity, face: a.face, location: a.location,
          element: a.element, observation: a.observation, proposal: a.proposal, justification: a.justification,
          status: a.status, resolution_note: a.resolutionNote,
          decided_by_name: a.decidedById ? nameById.get(a.decidedById) ?? null : null, decided_at: a.decidedAt,
          integration_status: a.integrationStatus, integration_note: a.integrationNote,
          integrated_by_name: a.integratedById ? nameById.get(a.integratedById) ?? null : null, integrated_at: a.integratedAt,
        })),
      });
    },
  );

  // Décision humaine sur une anomalie : accepter / modifier / rejeter / à
  // vérifier. Tracée (audit) ; on n'écrase jamais l'historique (append-only).
  const anomalyPatchSchema = z.object({
    status: z.string(),
    resolution_note: z.string().max(4000).nullable().optional(),
  });
  fastify.patch(
    "/api/v1/correction-anomalies/:id",
    { preHandler: requireAnyPermission(ANOMALY_WRITE_PERMS) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = anomalyPatchSchema.safeParse(request.body);
      if (!parsed.success || !isAnomalyStatus(parsed.data.status)) {
        return reply.code(400).send({ code: "invalid_body", message: "Statut invalide (attendu : à traiter / acceptée / modifiée / rejetée / à vérifier)." });
      }
      const existing = await prisma.correctionAnomaly.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ code: "not_found", message: "Anomalie introuvable." });
      const updated = await prisma.correctionAnomaly.update({
        where: { id },
        data: {
          status: parsed.data.status,
          resolutionNote: parsed.data.resolution_note ?? null,
          decidedById: request.user!.id,
          decidedAt: new Date(),
        },
      });
      await writeAuditLog({
        userId: request.user!.id, action: "update", entityType: "correction_anomaly", entityId: id,
        oldValues: { status: existing.status }, newValues: { status: updated.status, resolution_note: updated.resolutionNote },
        ipAddress: request.ip,
      });
      return reply.send({ ok: true });
    },
  );

  // — INTÉGRATION (2ᵉ temps du Lot 3) : geste de l'intégrateur DÉSIGNÉ, distinct
  // de la décision du correcteur. Il applique la correction retenue dans le
  // fichier puis coche l'état. Ne concerne que les anomalies acceptées/modifiées.
  const INTEGRATION_STATUSES = ["a_integrer", "integree", "a_revoir", "non_applicable"] as const;
  const anomalyIntegrationSchema = z.object({
    integration_status: z.enum(INTEGRATION_STATUSES),
    note: z.string().max(4000).nullable().optional(),
  });
  fastify.patch(
    "/api/v1/correction-anomalies/:id/integration",
    { preHandler: requireAnyPermission(AI_JOB_READ_PERMS) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = anomalyIntegrationSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "invalid_body", message: "État d'intégration invalide (attendu : à intégrer / intégrée / à revoir / non applicable)." });
      const existing = await prisma.correctionAnomaly.findUnique({ where: { id }, include: { job: { select: { workType: true } } } });
      if (!existing) return reply.code(404).send({ code: "not_found", message: "Anomalie introuvable." });
      if (existing.status !== "acceptee" && existing.status !== "modifiee") {
        return reply.code(409).send({ code: "not_integrable", message: "Seule une anomalie acceptée ou modifiée peut être intégrée." });
      }
      // Habilitation selon la BRANCHE : couverture → l'INFOGRAPHE de l'ouvrage
      // (responsable de l'étape Infographie) ; texte → l'intégrateur ÉDITORIAL
      // désigné. Une administration des manuscrits passe dans les deux cas.
      const isCover = existing.job.workType === "couverture";
      const isAdmin = request.user!.permissions.has("manuscripts:administration");
      if (!isAdmin) {
        const authorized = isCover
          ? (await manuscriptInfographeId(existing.manuscriptId)) === request.user!.id
          : (await prisma.manuscript.findUnique({ where: { id: existing.manuscriptId }, select: { correctionIntegratorId: true } }))?.correctionIntegratorId === request.user!.id;
        if (!authorized) {
          return reply.code(403).send({
            code: "not_integrator",
            message: isCover
              ? "Seul l'infographe de cet ouvrage peut cocher l'intégration de la couverture."
              : "Seul l'intégrateur désigné de cet ouvrage peut cocher l'intégration.",
          });
        }
      }
      if (parsed.data.integration_status === "non_applicable" && !(parsed.data.note && parsed.data.note.trim())) {
        return reply.code(400).send({ code: "note_required", message: "Indiquez le motif pour écarter une correction (« non applicable »)." });
      }
      const updated = await prisma.correctionAnomaly.update({
        where: { id },
        data: {
          integrationStatus: parsed.data.integration_status,
          integrationNote: parsed.data.note ?? null,
          integratedById: request.user!.id,
          integratedAt: new Date(),
        },
      });
      await writeAuditLog({
        userId: request.user!.id, action: "update", entityType: "correction_anomaly", entityId: id,
        oldValues: { integration_status: existing.integrationStatus }, newValues: { integration_status: updated.integrationStatus, integration_note: updated.integrationNote },
        ipAddress: request.ip,
      });
      return reply.send({ ok: true });
    },
  );

  // Inbox personnel de l'intégrateur : les ouvrages qu'on lui a confiés, avec le
  // nombre de corrections à intégrer. Deux branches :
  //  • TEXTE — ouvrages dont il est l'intégrateur éditorial désigné (jobs
  //    correction_1/2) ;
  //  • COUVERTURE — ouvrages dont il est l'infographe (jobs couverture).
  // Un même ouvrage peut apparaître sous les deux branches si la personne cumule
  // les deux rôles. Alimente l'écran « Mes intégrations de correction ».
  fastify.get(
    "/api/v1/my-correction-integrations",
    { preHandler: requireAnyPermission(AI_JOB_READ_PERMS) },
    async (request, reply) => {
      const me = request.user!.id;
      const emptyCounts = () => ({ a_integrer: 0, integree: 0, a_revoir: 0, non_applicable: 0, total: 0 });

      const tally = async (manuscriptIds: string[], workTypes: ("correction_1" | "correction_2" | "couverture")[]) => {
        if (manuscriptIds.length === 0) return new Map<string, ReturnType<typeof emptyCounts>>();
        const rows = await prisma.correctionAnomaly.findMany({
          where: { manuscriptId: { in: manuscriptIds }, status: { in: ["acceptee", "modifiee"] }, job: { workType: { in: workTypes } } },
          select: { manuscriptId: true, integrationStatus: true },
        });
        const m = new Map<string, ReturnType<typeof emptyCounts>>();
        for (const r of rows) {
          if (!m.has(r.manuscriptId)) m.set(r.manuscriptId, emptyCounts());
          const c = m.get(r.manuscriptId)!;
          c.total += 1;
          if (r.integrationStatus in c) (c as Record<string, number>)[r.integrationStatus] += 1;
        }
        return m;
      };

      // Présence du FICHIER FINAL par branche (autorise la clôture) : on cherche
      // les pièces d'étape « [correction:integration_finale] » (texte) ou
      // « [correction:couverture_finale] » (couverture) déposées, non supprimées.
      const withFinalFile = async (manuscriptIds: string[], phaseKey: string) => {
        if (manuscriptIds.length === 0) return new Set<string>();
        const docs = await prisma.document.findMany({
          where: { entityType: "manuscript", entityId: { in: manuscriptIds }, category: "piece_etape", deletedAt: null, title: { startsWith: `[correction:${phaseKey}]` } },
          select: { entityId: true },
        });
        return new Set(docs.map((d) => d.entityId));
      };

      // Branche TEXTE : ouvrages où je suis l'intégrateur éditorial désigné.
      const texteManuscripts = await prisma.manuscript.findMany({
        where: { deletedAt: null, correctionIntegratorId: me },
        select: { id: true, manuscriptNumber: true, title: true, correctionIntegrationClosedAt: true, status: { select: { code: true, label: true } } },
        orderBy: { updatedAt: "desc" },
      });
      const texteCounts = await tally(texteManuscripts.map((m) => m.id), ["correction_1", "correction_2"]);
      const texteFinal = await withFinalFile(texteManuscripts.map((m) => m.id), "integration_finale");

      // Branche COUVERTURE : ouvrages où je suis l'infographe — désigné pour la
      // correction de couverture, OU responsable de l'étape Infographie.
      const infoSteps = await prisma.manuscriptStep.findMany({
        where: { responsibleId: me, status: { code: "INFOGRAPHIE" }, manuscript: { deletedAt: null } },
        select: { manuscript: { select: { id: true, manuscriptNumber: true, title: true, coverIntegrationClosedAt: true, status: { select: { code: true, label: true } } } } },
      });
      const designated = await prisma.manuscript.findMany({
        where: { deletedAt: null, coverIntegratorId: me },
        select: { id: true, manuscriptNumber: true, title: true, coverIntegrationClosedAt: true, status: { select: { code: true, label: true } } },
      });
      type CoverM = { id: string; manuscriptNumber: string; title: string; coverIntegrationClosedAt: Date | null; status: { code: string; label: string } };
      const coverById = new Map<string, CoverM>();
      for (const s of infoSteps) coverById.set(s.manuscript.id, s.manuscript);
      for (const m of designated) coverById.set(m.id, m); // le désigné prime / dédoublonne
      const coverManuscripts = [...coverById.values()];
      const coverCounts = await tally(coverManuscripts.map((m) => m.id), ["couverture"]);
      const coverFinal = await withFinalFile(coverManuscripts.map((m) => m.id), "couverture_finale");

      const items = [
        ...texteManuscripts.map((m) => ({ id: m.id, manuscript_number: m.manuscriptNumber, title: m.title, status_code: m.status.code, status_label: m.status.label, branch: "texte" as const, counts: texteCounts.get(m.id) ?? emptyCounts(), closed_at: m.correctionIntegrationClosedAt?.toISOString() ?? null, can_close: texteFinal.has(m.id) })),
        ...coverManuscripts.map((m) => ({ id: m.id, manuscript_number: m.manuscriptNumber, title: m.title, status_code: m.status.code, status_label: m.status.label, branch: "couverture" as const, counts: coverCounts.get(m.id) ?? emptyCounts(), closed_at: m.coverIntegrationClosedAt?.toISOString() ?? null, can_close: coverFinal.has(m.id) })),
      ];
      return reply.send({ manuscripts: items });
    },
  );

  // Clôture (ou réouverture) de l'intégration par l'intégrateur, pour ranger
  // l'ouvrage dans l'accordéon « Historique » et libérer son écran. Une clôture
  // par branche (texte / couverture). NE clôt PAS l'étape Correction (validée par
  // le correcteur) : rangement personnel, réversible. Garde-fou : on ne peut clore
  // que si le FICHIER FINAL de la branche est déposé.
  fastify.put(
    "/api/v1/manuscripts/:id/integration-closure",
    { preHandler: requireAnyPermission(AI_JOB_READ_PERMS) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parse = z.object({ branch: z.enum(["texte", "couverture"]), closed: z.boolean() }).safeParse(request.body);
      if (!parse.success) return reply.code(400).send({ code: "validation_error", message: "Requête invalide." });
      const { branch, closed } = parse.data;
      const me = request.user!.id;
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null }, select: { id: true, correctionIntegratorId: true } });
      if (!manuscript) return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });

      // Habilitation : l'intégrateur désigné de la branche (ou la direction).
      let allowed = isDirection(request);
      if (!allowed) {
        allowed = branch === "texte" ? manuscript.correctionIntegratorId === me : (await manuscriptInfographeId(id)) === me;
      }
      if (!allowed) return reply.code(403).send({ code: "forbidden", message: "Seul l'intégrateur désigné de cet ouvrage peut clore cette intégration." });

      if (closed) {
        const phaseKey = branch === "texte" ? "integration_finale" : "couverture_finale";
        const finalDoc = await prisma.document.findFirst({ where: { entityType: "manuscript", entityId: id, category: "piece_etape", deletedAt: null, title: { startsWith: `[correction:${phaseKey}]` } }, select: { id: true } });
        if (!finalDoc) {
          return reply.code(409).send({ code: "final_missing", message: branch === "texte" ? "Déposez d'abord la version corrigée finale (VCF) avant de clore l'intégration." : "Déposez d'abord la couverture corrigée finale avant de clore l'intégration." });
        }
      }
      const data = branch === "texte" ? { correctionIntegrationClosedAt: closed ? new Date() : null } : { coverIntegrationClosedAt: closed ? new Date() : null };
      await prisma.manuscript.update({ where: { id }, data });
      await writeAuditLog({ userId: me, action: "update", entityType: "manuscript", entityId: id, newValues: { integration_closure: { branch, closed } }, ipAddress: request.ip });
      return reply.send({ id, branch, closed });
    },
  );

  // (Re)génère les fiches d'anomalies d'une relecture déjà terminée (best-effort ;
  // ne réextrait pas si des anomalies existent déjà — décisions préservées).
  fastify.post(
    "/api/v1/ai-editorial/jobs/:jobId/extract-anomalies",
    { preHandler: requireAnyPermission(ANOMALY_WRITE_PERMS) },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string };
      try {
        const r = await extractAnomaliesForJob(jobId);
        return reply.send(r);
      } catch (e) {
        if (e instanceof AiRunError) return reply.code(e.code === "not_found" ? 404 : 400).send({ code: e.code, message: e.message });
        return reply.code(500).send({ code: "extract_failed", message: e instanceof Error ? e.message : "Extraction impossible." });
      }
    },
  );

  // — Livrables produits par une relecture IA (« Générer les livrables ») —
  // Liste les documents effectivement produits par le job (rapport, version
  // réécrite…), avec un lien de téléchargement par pièce. Réutilise la GED et le
  // stockage existants (aucun second moteur de génération).
  fastify.get(
    "/api/v1/ai-editorial/jobs/:jobId/documents",
    { preHandler: requireAnyPermission(READ_JOB_PERMS) },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string };
      const job = await prisma.aiReadingJob.findUnique({ where: { id: jobId }, select: { producedDocumentIds: true } });
      if (!job) return reply.code(404).send({ code: "not_found", message: "Relecture introuvable." });
      const ids = Array.isArray(job.producedDocumentIds) ? (job.producedDocumentIds as string[]) : [];
      const docs = await prisma.document.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, title: true, category: true, versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { fileSize: true, mimeType: true } } },
      });
      // Conserve l'ordre de production (rapport d'abord, puis version réécrite…).
      const byId = new Map(docs.map((d) => [d.id, d]));
      const livrables = ids
        .map((id) => byId.get(id))
        .filter((d): d is NonNullable<typeof d> => Boolean(d))
        .map((d) => ({ id: d.id, title: d.title, category: d.category, file_size: d.versions[0]?.fileSize ?? null, mime_type: d.versions[0]?.mimeType ?? null }));
      return reply.send({ documents: livrables });
    },
  );

  // Téléchargement d'un livrable produit (validé comme appartenant au job).
  fastify.get(
    "/api/v1/ai-editorial/jobs/:jobId/documents/:docId/download",
    { preHandler: requireAnyPermission(READ_JOB_PERMS) },
    async (request, reply) => {
      const { jobId, docId } = request.params as { jobId: string; docId: string };
      const job = await prisma.aiReadingJob.findUnique({ where: { id: jobId }, select: { producedDocumentIds: true } });
      if (!job) return reply.code(404).send({ code: "not_found", message: "Relecture introuvable." });
      const ids = Array.isArray(job.producedDocumentIds) ? (job.producedDocumentIds as string[]) : [];
      if (!ids.includes(docId)) return reply.code(404).send({ code: "not_found", message: "Livrable introuvable pour cette relecture." });
      const version = await prisma.documentVersion.findFirst({ where: { document: { id: docId, deletedAt: null } }, orderBy: { versionNumber: "desc" } });
      if (!version) return reply.code(404).send({ code: "not_found", message: "Livrable introuvable (peut-être retiré)." });
      const { readStoredFile } = await import("../lib/storage.js");
      const buffer = await readStoredFile(version.filePath);
      reply.header("content-type", version.mimeType);
      reply.header("content-disposition", `attachment; filename="livrable_${docId.slice(0, 8)}.docx"`);
      return reply.send(buffer);
    },
  );
}
