import { prisma } from "./prisma.js";

// Bibliothèque de rapports standards (Ch. 20 §20.3) : un exécuteur par
// domaine, filtrable par période. Génération synchrone — aucune file de
// tâches asynchrones dans le projet (cf. docs/JOURNAL_TECHNIQUE.md) ; export
// CSV uniquement, pas de PDF/Excel binaire (même simplification que les
// autres exports du projet, ex. accounting_exports).
interface ReportParams {
  period_start?: string;
  period_end?: string;
}

function periodFilter(params: ReportParams, field = "createdAt") {
  const filter: Record<string, Date> = {};
  if (params.period_start) filter.gte = new Date(params.period_start);
  if (params.period_end) filter.lte = new Date(params.period_end);
  return Object.keys(filter).length > 0 ? { [field]: filter } : {};
}

async function editorialFlow(params: ReportParams) {
  const decisions = await prisma.editorialDecision.findMany({
    where: periodFilter(params, "decidedAt"),
    include: { manuscript: { include: { genre: true } } },
  });
  const byGenre = new Map<string, Record<string, number>>();
  for (const decision of decisions) {
    const genre = decision.manuscript.genre?.label ?? "Non classé";
    const entry = byGenre.get(genre) ?? {};
    entry[decision.decision] = (entry[decision.decision] ?? 0) + 1;
    byGenre.set(genre, entry);
  }
  const rows = [...byGenre.entries()].map(([genre, counts]) => ({ genre, ...counts }));
  return { rows, row_count: rows.length };
}

async function productionDelays() {
  const steps = await prisma.manuscriptStep.findMany({
    where: { actualStart: { not: null }, actualEnd: { not: null } },
    include: { status: true },
  });
  const byStatus = new Map<string, { label: string; totalDays: number; count: number }>();
  for (const step of steps) {
    const durationDays = (step.actualEnd!.getTime() - step.actualStart!.getTime()) / (1000 * 60 * 60 * 24);
    const entry = byStatus.get(step.statusId) ?? { label: step.status.label, totalDays: 0, count: 0 };
    entry.totalDays += durationDays;
    entry.count += 1;
    byStatus.set(step.statusId, entry);
  }
  const rows = [...byStatus.values()].map((e) => ({ status: e.label, avg_duration_days: Math.round((e.totalDays / e.count) * 10) / 10, sample_size: e.count }));
  return { rows, row_count: rows.length };
}

async function commercialSales(params: ReportParams) {
  const orders = await prisma.salesOrder.findMany({
    where: periodFilter(params, "createdAt"),
    include: { lines: { include: { isbn: { include: { manuscript: true } } } } },
  });
  const byChannel = new Map<string, { units: number; revenue: number }>();
  for (const order of orders) {
    const entry = byChannel.get(order.channel) ?? { units: 0, revenue: 0 };
    for (const line of order.lines) {
      entry.units += line.quantity;
      entry.revenue += line.quantity * Number(line.unitPrice) * (1 - Number(line.discountPct) / 100);
    }
    byChannel.set(order.channel, entry);
  }
  const rows = [...byChannel.entries()].map(([channel, e]) => ({ channel, units: e.units, revenue: Math.round(e.revenue * 100) / 100 }));
  return { rows, row_count: rows.length };
}

async function financialMargins() {
  const manuscripts = await prisma.manuscript.findMany({
    where: { deletedAt: null, isbns: { some: {} } },
    include: { isbns: true },
  });
  const rows = [];
  for (const manuscript of manuscripts) {
    const isbnIds = manuscript.isbns.map((i) => i.id);
    const [costEntries, purchaseOrders, invoiceLines] = await Promise.all([
      prisma.costEntry.findMany({ where: { manuscriptId: manuscript.id } }),
      prisma.purchaseOrder.findMany({ where: { quote: { manuscriptId: manuscript.id } } }),
      prisma.invoiceLine.findMany({ where: { isbnId: { in: isbnIds } }, include: { invoice: true } }),
    ]);
    if (costEntries.length === 0 && purchaseOrders.length === 0 && invoiceLines.length === 0) continue;
    const totalCost = costEntries.reduce((s, c) => s + Number(c.amount), 0) + purchaseOrders.reduce((s, po) => s + Number(po.amount), 0);
    const netSales = invoiceLines.reduce((s, l) => s + (l.invoice.type === "credit_note" ? -1 : 1) * Number(l.lineTotal), 0);
    rows.push({
      title: manuscript.title,
      total_cost: Math.round(totalCost * 100) / 100,
      net_sales: Math.round(netSales * 100) / 100,
      margin: Math.round((netSales - totalCost) * 100) / 100,
      under_break_even: netSales < totalCost,
    });
  }
  return { rows, row_count: rows.length };
}

async function rhWorkload() {
  const departments = await prisma.department.findMany({ where: { isActive: true } });
  const rows = [];
  for (const dept of departments) {
    const [openTasks, lateTasks, employeeCount] = await Promise.all([
      prisma.task.count({ where: { deletedAt: null, status: { in: ["en_cours", "non_commencee"] }, step: { status: { departmentId: dept.id } } } }),
      prisma.task.count({ where: { deletedAt: null, status: { notIn: ["terminee", "validee"] }, plannedEnd: { lt: new Date() }, step: { status: { departmentId: dept.id } } } }),
      prisma.employee.count({ where: { deletedAt: null, departmentId: dept.id, departureDate: null } }),
    ]);
    if (employeeCount === 0 && openTasks === 0) continue;
    rows.push({ department: dept.name, employee_count: employeeCount, open_tasks: openTasks, late_tasks: lateTasks });
  }
  return { rows, row_count: rows.length };
}

export const REPORT_EXECUTORS: Record<string, (params: ReportParams) => Promise<{ rows: unknown[]; row_count: number }>> = {
  editorial_flow: editorialFlow,
  production_delays: () => productionDelays(),
  commercial_sales: commercialSales,
  financial_margins: () => financialMargins(),
  rh_workload: () => rhWorkload(),
};
