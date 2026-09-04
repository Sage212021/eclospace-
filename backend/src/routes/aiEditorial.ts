import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAnyRole, requirePermission, requireAnyPermission } from "../lib/permissions.js";
import { startAiReading, executeAiReading, AiRunError } from "../lib/aiRunner.js";
import { writeAuditLog } from "../lib/audit.js";
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

  // — Lancement d'une relecture IA (Lot IA-1) —
  const runSchema = z.object({
    manuscript_id: z.string().uuid(),
    work_type: z.enum(WORK_TYPES),
    step_code: z.string().max(40).optional(),
    editor_recommendation: z.string().max(4000).optional(),
    // Passage BAT (couverture) : BAT1 = 1ᵉʳ passage, BAT2 = 2ᵉ passage (suivi
    // des corrections du BAT précédent, transmis automatiquement à l'IA).
    cover_pass: z.enum(["BAT1", "BAT2"]).optional(),
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
    { preHandler: requireAnyPermission([{ module: "comite_lecture", action: "consultation" }, { module: "manuscripts", action: "consultation" }]) },
    async (request, reply) => {
      const manuscriptId = (request.query as { manuscript?: string }).manuscript;
      if (!manuscriptId) return reply.code(400).send({ code: "manuscript_required", message: "Paramètre « manuscript » requis." });
      const jobs = await prisma.aiReadingJob.findMany({ where: { manuscriptId }, orderBy: { launchedAt: "desc" } });
      // Signale au lanceur qu'un rapport est téléchargeable (1er document produit).
      const withReport = jobs.map((j) => ({
        ...j,
        reportAvailable: j.status === "termine" && Array.isArray(j.producedDocumentIds) && (j.producedDocumentIds as unknown[]).length > 0,
      }));
      return reply.send({ jobs: withReport });
    },
  );

  // — Téléchargement du rapport produit par une relecture IA —
  // Volontairement accessible à quiconque peut consulter les relectures IA (même
  // porte que la liste ci-dessus) : le lecteur ou le correcteur récupère SON
  // rapport là où il l'a lancé, SANS exiger le droit « documents : consultation »
  // (la GED reste réservée). Le rapport est le 1er document produit par le job.
  fastify.get(
    "/api/v1/ai-editorial/jobs/:jobId/report",
    { preHandler: requireAnyPermission([{ module: "comite_lecture", action: "consultation" }, { module: "manuscripts", action: "consultation" }]) },
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
}
