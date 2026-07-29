import { prisma } from "./prisma.js";
import { availableQuantity } from "./stock.js";

// Ch. 5 §5.3, Ch. 20 §20.2-20.3 : le tableau de bord Direction générale et le
// module Rapports lisent tous deux ce registre — une seule source de
// vérité pour chaque indicateur diffusé. Portée volontairement limitée à un
// sous-ensemble représentatif de chaque famille (cf. docs/JOURNAL_TECHNIQUE.md)
// plutôt qu'un moteur de restitution générique : chaque fonction est un
// calcul explicite, documenté par la définition du dictionnaire KPI
// correspondant (voir seed des kpi_definitions).

export async function editorialIndicators() {
  const statuses = await prisma.workflowStatus.findMany({
    orderBy: { stepOrder: "asc" },
    include: { _count: { select: { manuscripts: { where: { deletedAt: null } } } } },
  });
  return {
    total: await prisma.manuscript.count({ where: { deletedAt: null } }),
    by_status: statuses.map((s) => ({ code: s.code, label: s.label, step_order: s.stepOrder, count: s._count.manuscripts })),
  };
}

export async function productionIndicators() {
  const [tasksLate, tasksDone, tasksOnTimeDone, allTasks] = await Promise.all([
    prisma.task.count({ where: { deletedAt: null, status: { notIn: ["terminee", "validee"] }, plannedEnd: { lt: new Date() } } }),
    prisma.task.count({ where: { deletedAt: null, status: { in: ["terminee", "validee"] } } }),
    prisma.task.count({
      where: { deletedAt: null, status: { in: ["terminee", "validee"] }, actualEnd: { not: null }, plannedEnd: { not: null } },
    }),
    prisma.task.findMany({
      where: { deletedAt: null, status: { in: ["terminee", "validee"] }, actualEnd: { not: null }, plannedEnd: { not: null } },
      select: { actualEnd: true, plannedEnd: true },
    }),
  ]);
  const onTimeCount = allTasks.filter((t) => t.actualEnd! <= t.plannedEnd!).length;
  const onTimeRate = tasksOnTimeDone > 0 ? Math.round((onTimeCount / tasksOnTimeDone) * 10000) / 100 : null;

  const workloadByDepartment = await prisma.task.groupBy({
    by: ["stepId"],
    where: { deletedAt: null, status: { in: ["en_cours", "non_commencee"] } },
    _count: true,
  });

  return {
    projects_in_progress: await prisma.manuscript.count({ where: { deletedAt: null, status: { code: { notIn: ["ARCHIVAGE"] } } } }),
    tasks_done: tasksDone,
    tasks_late: tasksLate,
    on_time_rate_pct: onTimeRate,
    open_tasks_by_step: workloadByDepartment.length,
  };
}

// Les prestations « compte d'auteur » (devis éditorial / impression /
// communication) sont facturées via la Finance mais NE SONT PAS des ventes
// commerciales de livres : on les exclut des indicateurs commerciaux (ventes,
// chiffre d'affaires, meilleures ventes) pour ne pas gonfler le tableau de bord
// avec des services. Elles restent bien comptées côté Finance (créances).
const PRESTATION_QUOTE_SOURCES = ["editorial_quote", "impression_quote", "communication_quote"];

export async function commercialIndicators() {
  const [invoiceLines, stockItems] = await Promise.all([
    prisma.invoiceLine.findMany({
      where: { invoice: { sourceType: { notIn: PRESTATION_QUOTE_SOURCES } } },
      include: { invoice: true, isbn: { include: { manuscript: true } } },
    }),
    prisma.stockItem.findMany({ where: { condition: "vendable" } }),
  ]);

  let unitsSold = 0;
  let revenueTotal = 0;
  const byTitle = new Map<string, { title: string; units: number; revenue: number }>();
  for (const line of invoiceLines) {
    const sign = line.invoice.type === "credit_note" ? -1 : 1;
    unitsSold += sign * line.quantity;
    revenueTotal += sign * Number(line.lineTotal);
    const title = line.isbn?.manuscript?.title;
    if (title) {
      const entry = byTitle.get(title) ?? { title, units: 0, revenue: 0 };
      entry.units += sign * line.quantity;
      entry.revenue += sign * Number(line.lineTotal);
      byTitle.set(title, entry);
    }
  }
  const bestSellers = [...byTitle.values()].sort((a, b) => b.units - a.units).slice(0, 5);
  const stockOuts = stockItems.filter((item) => availableQuantity(item) <= item.outOfStockThreshold).length;

  return {
    units_sold: unitsSold,
    revenue_total: Math.round(revenueTotal * 100) / 100,
    best_sellers: bestSellers,
    stock_outs: stockOuts,
  };
}

// Réservé aux profils habilités (finance:consultation, Ch. 5 §5.2, §18).
export async function financialIndicators() {
  const [costEntries, purchaseOrders, expensesUnpaid, royaltyDue, invoices] = await Promise.all([
    prisma.costEntry.aggregate({ _sum: { amount: true } }),
    prisma.purchaseOrder.aggregate({ _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { status: { in: ["a_valider", "en_attente_dg", "validee"] } }, _sum: { amount: true } }),
    prisma.royaltyStatement.aggregate({ where: { status: "issued" }, _sum: { balanceDue: true } }),
    prisma.invoice.findMany({ where: { type: "invoice", status: { not: "cancelled" } }, include: { paymentAllocations: true, creditNotes: true } }),
  ]);

  const invoicesPending = invoices.reduce((sum, invoice) => {
    const allocated = invoice.paymentAllocations.reduce((s, a) => s + Number(a.amount), 0);
    const credited = invoice.creditNotes.reduce((s, c) => s + Number(c.totalTtc), 0);
    const due = Number(invoice.totalTtc) - allocated - credited;
    return sum + Math.max(due, 0);
  }, 0);

  const [incoming, outgoing] = await Promise.all([
    prisma.payment.aggregate({ where: { direction: "in" }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { direction: "out" }, _sum: { amount: true } }),
  ]);

  return {
    production_cost_total: Math.round((Number(costEntries._sum.amount ?? 0) + Number(purchaseOrders._sum.amount ?? 0)) * 100) / 100,
    expenses_engaged: Math.round(Number(expensesUnpaid._sum.amount ?? 0) * 100) / 100,
    royalties_due: Math.round(Number(royaltyDue._sum.balanceDue ?? 0) * 100) / 100,
    invoices_pending: Math.round(invoicesPending * 100) / 100,
    treasury_position: Math.round((Number(incoming._sum.amount ?? 0) - Number(outgoing._sum.amount ?? 0)) * 100) / 100,
  };
}

// Registre par code (Ch. 20 §20.2) : GET /kpi/:code s'appuie sur cette
// fonction unique par indicateur du dictionnaire (kpi_definitions), pour
// garantir une seule source de vérité et une seule formule par indicateur.
export const KPI_REGISTRY: Record<string, () => Promise<unknown>> = {
  manuscripts_by_status: async () => (await editorialIndicators()).by_status,
  on_time_rate_pct: async () => (await productionIndicators()).on_time_rate_pct,
  revenue_total: async () => (await commercialIndicators()).revenue_total,
  royalties_due: async () => (await financialIndicators()).royalties_due,
  treasury_position: async () => (await financialIndicators()).treasury_position,
};
