import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { KPI_REGISTRY } from "../lib/kpi.js";
import { REPORT_EXECUTORS } from "../lib/reports.js";

const analysisSchema = z.object({
  label: z.string().min(1),
  definition: z.object({
    metric: z.string().min(1),
  }).catchall(z.unknown()),
  shared_with: z.array(z.string().uuid()).default([]),
});

// Modules financiers du rapport "financial_margins" (Ch. 20 §20.2 : "les
// rapports financiers suivent les restrictions du Ch. 18").
const FINANCIAL_REPORT_KEYS = new Set(["financial_margins"]);

// Ch. 20 : Rapports, statistiques et intelligence décisionnelle — lit les
// données de tous les modules, n'écrit que ses propres artefacts (§20.9).
export default async function reportsRoutes(fastify: FastifyInstance) {
  // Dictionnaire des indicateurs (§20.2) : définition et formule jointes à
  // chaque valeur calculée — une seule source de vérité par indicateur.
  fastify.get("/api/v1/kpi/:code", { preHandler: requirePermission("rapports", "consultation") }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const definition = await prisma.kpiDefinition.findUnique({ where: { code } });
    if (!definition) {
      return reply.code(404).send({ code: "not_found", message: "Indicateur inconnu au dictionnaire." });
    }
    const compute = KPI_REGISTRY[code];
    if (!compute) {
      return reply.code(501).send({ code: "not_implemented", message: "Indicateur documenté mais pas encore calculable." });
    }
    const value = await compute();
    return reply.send({ ...definition, value });
  });

  fastify.get("/api/v1/kpi", { preHandler: requirePermission("rapports", "consultation") }, async (_request, reply) => {
    const definitions = await prisma.kpiDefinition.findMany({ orderBy: { code: "asc" } });
    return reply.send(definitions);
  });

  // Bibliothèque de rapports standards (§20.3).
  fastify.get("/api/v1/reports", { preHandler: requirePermission("rapports", "consultation") }, async (request, reply) => {
    const reports = await prisma.report.findMany({ orderBy: { domain: "asc" } });
    const visible = reports.filter((r) => !FINANCIAL_REPORT_KEYS.has(r.key) || request.user!.permissions.has("finance:consultation"));
    return reply.send(visible);
  });

  fastify.post(
    "/api/v1/reports/:id/run",
    { preHandler: requirePermission("rapports", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const report = await prisma.report.findUnique({ where: { id } });
      if (!report) {
        return reply.code(404).send({ code: "not_found", message: "Rapport introuvable au catalogue." });
      }
      if (FINANCIAL_REPORT_KEYS.has(report.key) && !request.user!.permissions.has("finance:consultation")) {
        return reply.code(403).send({ code: "forbidden", message: "Ce rapport financier requiert finance:consultation (Ch. 20 §20.2, Ch. 18)." });
      }
      const executor = REPORT_EXECUTORS[report.key];
      if (!executor) {
        return reply.code(501).send({ code: "not_implemented", message: "Rapport catalogué mais pas encore exécutable." });
      }
      const schema = z.object({ period_start: z.string().datetime().optional(), period_end: z.string().datetime().optional() });
      const parsed = schema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      // Génération synchrone (§20.3, §21.10) : aucune file de tâches
      // asynchrones dans le projet — acceptable pour les volumétries
      // actuelles, à revoir si un rapport devient lourd en production.
      const result = await executor(parsed.data);
      const run = await prisma.reportRun.create({
        data: { reportId: id, params: parsed.data, generatedBy: request.user!.id, rowCount: result.row_count },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "export",
        entityType: "report_run",
        entityId: run.id,
        newValues: { reportKey: report.key, rowCount: result.row_count },
        ipAddress: request.ip,
      });
      return reply.code(201).send({ run, rows: result.rows });
    },
  );

  fastify.get("/api/v1/reports/:id/runs", { preHandler: requirePermission("rapports", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const runs = await prisma.reportRun.findMany({ where: { reportId: id }, orderBy: { generatedAt: "desc" } });
    return reply.send(runs);
  });

  // Explorateur d'analyses (§20.4) : dimensions/métriques contraintes au
  // registre KPI (portée réduite, cf. docs/JOURNAL_TECHNIQUE.md) plutôt
  // qu'un moteur de tableau croisé entièrement libre.
  fastify.post("/api/v1/analyses", { preHandler: requirePermission("rapports", "saisie") }, async (request, reply) => {
    const parsed = analysisSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    if (!KPI_REGISTRY[parsed.data.definition.metric]) {
      return reply.code(400).send({ code: "validation_error", message: `Métrique inconnue du registre KPI : ${parsed.data.definition.metric}.` });
    }
    const analysis = await prisma.savedAnalysis.create({
      data: {
        label: parsed.data.label,
        ownerId: request.user!.id,
        definition: JSON.parse(JSON.stringify(parsed.data.definition)),
        sharedWith: parsed.data.shared_with,
      },
    });
    return reply.code(201).send(analysis);
  });

  fastify.get("/api/v1/analyses", { preHandler: requirePermission("rapports", "consultation") }, async (request, reply) => {
    const analyses = await prisma.savedAnalysis.findMany({
      where: { OR: [{ ownerId: request.user!.id }, { sharedWith: { has: request.user!.id } }] },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(analyses);
  });

  fastify.post("/api/v1/analyses/:id/run", { preHandler: requirePermission("rapports", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const analysis = await prisma.savedAnalysis.findFirst({
      where: { id, OR: [{ ownerId: request.user!.id }, { sharedWith: { has: request.user!.id } }] },
    });
    if (!analysis) {
      return reply.code(404).send({ code: "not_found", message: "Analyse introuvable ou non partagée avec vous." });
    }
    const definition = analysis.definition as { metric: string };
    const compute = KPI_REGISTRY[definition.metric];
    if (!compute) {
      return reply.code(501).send({ code: "not_implemented", message: "Métrique enregistrée mais plus disponible au registre." });
    }
    return reply.send({ metric: definition.metric, value: await compute() });
  });

  // Promotion d'une analyse personnelle en rapport standard (§20.4), réservée
  // à l'administrateur du module.
  fastify.post(
    "/api/v1/analyses/:id/promote",
    { preHandler: requirePermission("rapports", "administration") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const schema = z.object({ key: z.string().min(1), domain: z.enum(["editorial", "production", "commercial", "financier", "rh"]) });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const analysis = await prisma.savedAnalysis.findUnique({ where: { id } });
      if (!analysis) {
        return reply.code(404).send({ code: "not_found", message: "Analyse introuvable." });
      }
      const report = await prisma.$transaction(async (tx) => {
        const created = await tx.report.create({
          data: { key: parsed.data.key, label: analysis.label, domain: parsed.data.domain, ownerId: analysis.ownerId },
        });
        await tx.savedAnalysis.update({ where: { id }, data: { promotedReportId: created.id } });
        return created;
      });
      await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "report", entityId: report.id, newValues: report, ipAddress: request.ip });
      return reply.code(201).send(report);
    },
  );

  // Simulation de tirage (§20.6) : croise les hypothèses de devis (Ch. 15)
  // avec le rythme de vente courant pour comparer un coût unitaire à une
  // durée d'écoulement estimée.
  fastify.post(
    "/api/v1/simulations/print-run",
    { preHandler: requirePermission("rapports", "consultation") },
    async (request, reply) => {
      const schema = z.object({ manuscript_id: z.string().uuid(), quantities: z.array(z.number().int().positive()).min(1) });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const quotes = await prisma.printQuote.findMany({
        where: { manuscriptId: parsed.data.manuscript_id },
        orderBy: { createdAt: "desc" },
      });
      const quote = quotes.find((q) => q.amounts !== null);
      const amounts = (quote?.amounts as Record<string, number> | null) ?? {};

      const isbns = await prisma.isbn.findMany({ where: { manuscriptId: parsed.data.manuscript_id } });
      const isbnIds = isbns.map((i) => i.id);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const recentSales = await prisma.invoiceLine.aggregate({
        where: { isbnId: { in: isbnIds }, invoice: { type: "invoice", createdAt: { gte: thirtyDaysAgo } } },
        _sum: { quantity: true },
      });
      const dailyRate = Number(recentSales._sum.quantity ?? 0) / 30;

      const simulations = parsed.data.quantities.map((quantity) => {
        const totalCost = amounts[String(quantity)] ?? null;
        return {
          quantity,
          total_cost: totalCost,
          unit_cost: totalCost !== null ? Math.round((totalCost / quantity) * 100) / 100 : null,
          estimated_days_to_sell_out: dailyRate > 0 ? Math.round(quantity / dailyRate) : null,
        };
      });
      return reply.send({ manuscript_id: parsed.data.manuscript_id, daily_sale_rate: Math.round(dailyRate * 100) / 100, simulations });
    },
  );
}
