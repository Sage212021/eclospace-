import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAnyRole, requirePermission } from "../lib/permissions.js";
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
}
