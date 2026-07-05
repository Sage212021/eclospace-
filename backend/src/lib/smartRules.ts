import { prisma } from "./prisma.js";
import { availableQuantity } from "./stock.js";
import type { RecommendationPriority, SmartRule } from "@prisma/client";

// Centre de pilotage intelligent (Ch. 5 §5.9, Ch. 20 §20.6) : chaque règle
// active est évaluée à la demande — aucune tâche planifiée n'existe dans le
// projet (cf. docs/JOURNAL_TECHNIQUE.md), donc pas d'exécution en tâche de
// fond. Une recommandation "ouverte" existante pour la même règle+entité
// n'est jamais dupliquée.
async function upsertOpenRecommendation(rule: SmartRule, entityType: string, entityId: string, message: string, priority: RecommendationPriority) {
  const existing = await prisma.recommendation.findFirst({
    where: { ruleId: rule.id, entityType, entityId, status: "open" },
  });
  if (existing) return null;
  return prisma.recommendation.create({
    data: { ruleId: rule.id, entityType, entityId, message, priority },
  });
}

async function evaluateBlockedManuscripts(rule: SmartRule) {
  const params = rule.params as { blocked_days_threshold?: number };
  const thresholdDays = params.blocked_days_threshold ?? 10;
  const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);

  const blockedSteps = await prisma.manuscriptStep.findMany({
    where: { validatedAt: null, actualStart: { lt: cutoff }, manuscript: { deletedAt: null } },
    include: { status: true, manuscript: true },
  });

  const byStatus = new Map<string, { label: string; count: number }>();
  for (const step of blockedSteps) {
    const entry = byStatus.get(step.statusId) ?? { label: step.status.label, count: 0 };
    entry.count += 1;
    byStatus.set(step.statusId, entry);
  }

  const created = [];
  for (const [statusId, { label, count }] of byStatus) {
    const message = `${count} manuscrit${count > 1 ? "s sont bloqués" : " est bloqué"} en ${label} depuis plus de ${thresholdDays} jours.`;
    const result = await upsertOpenRecommendation(rule, "workflow_status", statusId, message, rule.priority);
    if (result) created.push(result);
  }
  return created;
}

async function evaluateStockProjection(rule: SmartRule) {
  const params = rule.params as { projection_days?: number };
  const projectionDays = params.projection_days ?? 7;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const stockItems = await prisma.stockItem.findMany({
    where: { condition: "vendable" },
    include: { isbn: { include: { manuscript: true } } },
  });

  const created = [];
  for (const item of stockItems) {
    const available = availableQuantity(item);
    if (available <= item.outOfStockThreshold) continue; // déjà en rupture, couvert par l'alerte §5.6

    const soldRecently = await prisma.invoiceLine.aggregate({
      where: { isbnId: item.isbnId, invoice: { type: "invoice", createdAt: { gte: thirtyDaysAgo } } },
      _sum: { quantity: true },
    });
    const dailyRate = Number(soldRecently._sum.quantity ?? 0) / 30;
    if (dailyRate <= 0) continue;
    const daysToEmpty = available / dailyRate;
    if (daysToEmpty > projectionDays) continue;

    const title = item.isbn.manuscript?.title ?? item.isbn.isbn13;
    const message = `Le stock du titre "${title}" atteindra le seuil d'alerte dans environ ${Math.max(Math.round(daysToEmpty), 0)} jour(s) au rythme de vente actuel.`;
    const result = await upsertOpenRecommendation(rule, "stock_item", item.id, message, rule.priority);
    if (result) created.push(result);
  }
  return created;
}

async function evaluateBudgetOverrun(rule: SmartRule) {
  const params = rule.params as { variance_pct_threshold?: number };
  const thresholdPct = params.variance_pct_threshold ?? 15;

  const budgetLines = await prisma.budgetLine.findMany({ include: { budget: { include: { manuscript: true } } } });
  const created = [];
  for (const line of budgetLines) {
    if (!line.budget.manuscriptId) continue;
    const costEntries = await prisma.costEntry.findMany({ where: { manuscriptId: line.budget.manuscriptId, costType: line.costType } });
    const actual = costEntries.reduce((sum, c) => sum + Number(c.amount), 0);
    const planned = Number(line.revisedAmount ?? line.plannedAmount);
    if (planned <= 0) continue;
    const variancePct = ((actual - planned) / planned) * 100;
    if (variancePct < thresholdPct) continue;

    const title = line.budget.manuscript?.title ?? line.budget.label;
    const message = `Le coût de production de "${title}" (${line.costType}) dépasse le budget prévu de ${Math.round(variancePct)} %.`;
    const result = await upsertOpenRecommendation(rule, "budget_line", line.id, message, rule.priority);
    if (result) created.push(result);
  }
  return created;
}

const EVALUATORS: Record<string, (rule: SmartRule) => Promise<unknown[]>> = {
  manuscrits_bloques: evaluateBlockedManuscripts,
  stock_seuil_proche: evaluateStockProjection,
  depassement_budget: evaluateBudgetOverrun,
};

export async function generateRecommendations(): Promise<number> {
  const activeRules = await prisma.smartRule.findMany({ where: { isActive: true } });
  let totalCreated = 0;
  for (const rule of activeRules) {
    const evaluator = EVALUATORS[rule.code];
    if (!evaluator) continue;
    const created = await evaluator(rule);
    totalCreated += created.length;
  }
  return totalCreated;
}
