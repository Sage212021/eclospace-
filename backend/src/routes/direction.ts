import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { editorialIndicators, productionIndicators, commercialIndicators, financialIndicators } from "../lib/kpi.js";
import { availableQuantity } from "../lib/stock.js";

// Ch. 5 : module Direction générale — agrège et restitue les données déjà
// produites par les modules opérationnels (§5.1), ne saisit rien.
export default async function directionRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/dashboards/direction", { preHandler: requirePermission("direction", "consultation") }, async (request, reply) => {
    const [editorial, production, commercial] = await Promise.all([editorialIndicators(), productionIndicators(), commercialIndicators()]);
    const financial = request.user!.permissions.has("finance:consultation") ? await financialIndicators() : null;
    return reply.send({ editorial, production, commercial, financial });
  });

  // Indicateurs d'un département donné (Ch. 5 §5.3) — vue restreinte au
  // périmètre du département, réutilisée par chaque module ("son propre
  // tableau de bord livré au fil des lots 1-5", plan §2).
  fastify.get(
    "/api/v1/dashboards/:department",
    { preHandler: requirePermission("direction", "consultation") },
    async (request, reply) => {
      const { department } = request.params as { department: string };
      const dept = await prisma.department.findUnique({ where: { code: department.toUpperCase() } });
      if (!dept) {
        return reply.code(404).send({ code: "not_found", message: "Département introuvable." });
      }
      const [manuscriptsByStatus, openTasks, lateTasks] = await Promise.all([
        prisma.manuscript.groupBy({ by: ["statusId"], where: { deletedAt: null, status: { departmentId: dept.id } }, _count: true }),
        prisma.task.count({ where: { deletedAt: null, status: { in: ["en_cours", "non_commencee"] }, step: { status: { departmentId: dept.id } } } }),
        prisma.task.count({ where: { deletedAt: null, status: { notIn: ["terminee", "validee"] }, plannedEnd: { lt: new Date() }, step: { status: { departmentId: dept.id } } } }),
      ]);
      return reply.send({
        department: dept.code,
        manuscripts_at_department_statuses: manuscriptsByStatus.reduce((sum, g) => sum + g._count, 0),
        open_tasks: openTasks,
        late_tasks: lateTasks,
      });
    },
  );

  // Moteur de recherche global (Ch. 5 §5.4) : critères combinables.
  fastify.get("/api/v1/search", { preHandler: requirePermission("direction", "consultation") }, async (request, reply) => {
    const query = request.query as {
      q?: string;
      collection_id?: string;
      status_code?: string;
      manager_id?: string;
      late?: string;
    };
    const manuscripts = await prisma.manuscript.findMany({
      where: {
        deletedAt: null,
        ...(query.collection_id ? { collectionId: query.collection_id } : {}),
        ...(query.status_code ? { status: { code: query.status_code } } : {}),
        ...(query.manager_id ? { projectManagerId: query.manager_id } : {}),
        ...(query.q
          ? {
              OR: [
                { manuscriptNumber: { contains: query.q, mode: "insensitive" } },
                { title: { contains: query.q, mode: "insensitive" } },
                { workContributors: { some: { partner: { OR: [{ firstName: { contains: query.q, mode: "insensitive" } }, { lastName: { contains: query.q, mode: "insensitive" } }] } } } },
                { collection: { label: { contains: query.q, mode: "insensitive" } } },
                { isbns: { some: { isbn13: { contains: query.q } } } },
              ],
            }
          : {}),
      },
      include: { status: true, collection: true, genre: true, projectManager: true, workContributors: { include: { partner: true } } },
      take: 200,
    });
    return reply.send(manuscripts);
  });

  // Fiche synthétique d'un ouvrage (Ch. 5 §5.5) : la vue "direction" de la
  // frise chronologique (Ch. 4 §4.4), déjà construite par les autres modules.
  fastify.get(
    "/api/v1/manuscripts/:id/dashboard",
    { preHandler: requirePermission("direction", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const manuscript = await prisma.manuscript.findFirst({
        where: { id, deletedAt: null },
        include: {
          status: true,
          collection: true,
          genre: true,
          owner: { select: { id: true, username: true } },
          projectManager: { select: { id: true, username: true } },
          workContributors: { include: { partner: true } },
          steps: { include: { status: true }, orderBy: { status: { stepOrder: "asc" } } },
        },
      });
      if (!manuscript) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }

      const totalSteps = manuscript.steps.length;
      const completedSteps = manuscript.steps.filter((s) => s.validatedAt !== null).length;
      const progressPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 10000) / 100 : 0;

      const [expenses, invoiceLines] = await Promise.all([
        prisma.expense.aggregate({ where: { manuscriptId: id }, _sum: { amount: true } }),
        prisma.invoiceLine.findMany({ where: { isbn: { manuscriptId: id } }, include: { invoice: true } }),
      ]);
      const salesTotal = invoiceLines.reduce((sum, l) => sum + (l.invoice.type === "credit_note" ? -1 : 1) * Number(l.lineTotal), 0);

      return reply.send({
        manuscript: {
          id: manuscript.id,
          manuscript_number: manuscript.manuscriptNumber,
          title: manuscript.title,
          collection: manuscript.collection?.label ?? null,
          status: manuscript.status.label,
          owner: manuscript.owner,
          project_manager: manuscript.projectManager,
          contributors: manuscript.workContributors.map((c) => ({ role: c.role, name: `${c.partner.firstName} ${c.partner.lastName}` })),
        },
        progress_pct: progressPct,
        timeline: manuscript.steps.map((s) => ({
          status: s.status.label,
          step_order: s.status.stepOrder,
          planned_start: s.plannedStart,
          planned_end: s.plannedEnd,
          actual_start: s.actualStart,
          actual_end: s.actualEnd,
          validated_at: s.validatedAt,
        })),
        expenses_engaged: Math.round(Number(expenses._sum.amount ?? 0) * 100) / 100,
        sales_total: Math.round(salesTotal * 100) / 100,
      });
    },
  );

  // Alertes automatiques (Ch. 5 §5.6) : quatre niveaux de priorité.
  fastify.get("/api/v1/alerts", { preHandler: requirePermission("direction", "consultation") }, async (_request, reply) => {
    const now = new Date();
    const [lateTasks, pendingValidations, unsignedContracts, batToApprove, lowStock, overdueInvoices] = await Promise.all([
      prisma.task.findMany({
        where: { deletedAt: null, status: { notIn: ["terminee", "validee"] }, plannedEnd: { lt: now } },
        include: { manuscript: true },
        take: 50,
      }),
      prisma.manuscriptStep.findMany({
        where: { validatedAt: null, plannedEnd: { lt: now } },
        include: { manuscript: true, status: true },
        take: 50,
      }),
      prisma.contract.findMany({ where: { deletedAt: null, status: "awaiting_signature" }, include: { manuscript: true } }),
      prisma.batRecord.findMany({ where: { status: "awaiting_signature" }, include: { manuscript: true } }),
      prisma.stockItem.findMany({ where: { condition: "vendable" }, include: { isbn: { include: { manuscript: true } } } }),
      prisma.invoice.findMany({
        where: { type: "invoice", status: { not: "cancelled" }, dueDate: { lt: now } },
        include: { paymentAllocations: true, creditNotes: true, customer: true },
      }),
    ]);

    const alerts: { type: string; priority: "faible" | "moyenne" | "elevee" | "critique"; message: string; entity_type: string; entity_id: string }[] = [];

    for (const task of lateTasks) {
      const daysLate = Math.floor((now.getTime() - task.plannedEnd!.getTime()) / (1000 * 60 * 60 * 24));
      alerts.push({
        type: "tache_en_retard",
        priority: daysLate > 14 ? "critique" : daysLate > 7 ? "elevee" : "moyenne",
        message: `Tâche "${task.title}" en retard de ${daysLate} jour(s) (${task.manuscript.title}).`,
        entity_type: "task",
        entity_id: task.id,
      });
    }
    for (const step of pendingValidations) {
      alerts.push({
        type: "validation_en_attente",
        priority: "moyenne",
        message: `Étape "${step.status.label}" en attente de validation pour ${step.manuscript.title}.`,
        entity_type: "manuscript_step",
        entity_id: step.id,
      });
    }
    for (const contract of unsignedContracts) {
      alerts.push({
        type: "contrat_non_signe",
        priority: "moyenne",
        message: `Contrat ${contract.contractNumber} en attente de signature${contract.manuscript ? ` (${contract.manuscript.title})` : ""}.`,
        entity_type: "contract",
        entity_id: contract.id,
      });
    }
    for (const bat of batToApprove) {
      alerts.push({
        type: "bat_a_approuver",
        priority: "elevee",
        message: `BAT du cycle ${bat.cycleNumber} en attente de signature pour ${bat.manuscript.title}.`,
        entity_type: "bat_record",
        entity_id: bat.id,
      });
    }
    for (const item of lowStock) {
      const available = availableQuantity(item);
      if (available > item.outOfStockThreshold && (item.alertThreshold === null || available > item.alertThreshold)) continue;
      alerts.push({
        type: "stock_faible",
        priority: available <= item.outOfStockThreshold ? "critique" : "moyenne",
        message: `Stock faible pour ${item.isbn.manuscript?.title ?? item.isbn.isbn13} (${available} exemplaire(s) disponible(s)).`,
        entity_type: "stock_item",
        entity_id: item.id,
      });
    }
    for (const invoice of overdueInvoices) {
      const allocated = invoice.paymentAllocations.reduce((s, a) => s + Number(a.amount), 0);
      const credited = invoice.creditNotes.reduce((s, c) => s + Number(c.totalTtc), 0);
      const due = Number(invoice.totalTtc) - allocated - credited;
      if (due <= 0) continue;
      const daysLate = Math.floor((now.getTime() - invoice.dueDate!.getTime()) / (1000 * 60 * 60 * 24));
      alerts.push({
        type: "echeance_paiement",
        priority: daysLate > 60 ? "critique" : daysLate > 30 ? "elevee" : "moyenne",
        message: `Facture ${invoice.invoiceNumber} échue depuis ${daysLate} jour(s) (${invoice.customer.name}).`,
        entity_type: "invoice",
        entity_id: invoice.id,
      });
    }

    const priorityOrder = { critique: 0, elevee: 1, moyenne: 2, faible: 3 };
    alerts.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    return reply.send(alerts);
  });
}
