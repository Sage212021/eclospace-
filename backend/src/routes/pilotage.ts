import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RecommendationPriority, RecommendationStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { generateRecommendations } from "../lib/smartRules.js";

const smartRuleSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  params: z.record(z.unknown()).default({}),
  priority: z.nativeEnum(RecommendationPriority).default("moyenne"),
  is_active: z.boolean().default(true),
});

const decisionSchema = z.object({
  status: z.enum(["treated", "ignored", "postponed"]),
  comment: z.string().optional(),
});

// Ch. 5 §5.9, Ch. 20 §20.6 : centre de pilotage intelligent — des règles
// configurables produisent des recommandations en langage naturel,
// traçables jusqu'à leur traitement.
export default async function pilotageRoutes(fastify: FastifyInstance) {
  fastify.post("/api/v1/smart-rules", { preHandler: requirePermission("pilotage", "administration") }, async (request, reply) => {
    const parsed = smartRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const params = JSON.parse(JSON.stringify(parsed.data.params));
    const rule = await prisma.smartRule.upsert({
      where: { code: parsed.data.code },
      update: {
        label: parsed.data.label,
        description: parsed.data.description,
        params,
        priority: parsed.data.priority,
        isActive: parsed.data.is_active,
      },
      create: {
        code: parsed.data.code,
        label: parsed.data.label,
        description: parsed.data.description,
        params,
        priority: parsed.data.priority,
        isActive: parsed.data.is_active,
      },
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "smart_rule", entityId: rule.id, newValues: rule, ipAddress: request.ip });
    return reply.code(201).send(rule);
  });

  fastify.get("/api/v1/smart-rules", { preHandler: requirePermission("pilotage", "consultation") }, async (_request, reply) => {
    const rules = await prisma.smartRule.findMany({ orderBy: { code: "asc" } });
    return reply.send(rules);
  });

  // Génération à la demande (pas de tâche planifiée dans le projet) :
  // évalue toutes les règles actives, sans dupliquer une recommandation déjà
  // ouverte pour la même règle et la même entité.
  fastify.post("/api/v1/recommendations/generate", { preHandler: requirePermission("pilotage", "consultation") }, async (_request, reply) => {
    const createdCount = await generateRecommendations();
    return reply.code(201).send({ created: createdCount });
  });

  fastify.get("/api/v1/recommendations", { preHandler: requirePermission("pilotage", "consultation") }, async (request, reply) => {
    const query = request.query as { status?: string; priority?: string };
    const recommendations = await prisma.recommendation.findMany({
      where: {
        ...(query.status ? { status: query.status as RecommendationStatus } : {}),
        ...(query.priority ? { priority: query.priority as RecommendationPriority } : {}),
      },
      include: { rule: true },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(recommendations);
  });

  fastify.patch(
    "/api/v1/recommendations/:id",
    { preHandler: requirePermission("pilotage", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = decisionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const recommendation = await prisma.recommendation.update({
        where: { id },
        data: {
          status: parsed.data.status,
          decisionComment: parsed.data.comment,
          treatedBy: request.user!.id,
          treatedAt: new Date(),
        },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "recommendation",
        entityId: id,
        newValues: { status: parsed.data.status, comment: parsed.data.comment },
        ipAddress: request.ip,
      });
      return reply.send(recommendation);
    },
  );
}
