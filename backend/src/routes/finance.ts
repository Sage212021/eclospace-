import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PaymentMethod, ExpenseCategory, CostType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { assertPeriodOpen, PeriodClosedError, periodKeyFor } from "../lib/accountingPeriod.js";
import { computeCustomerOutstandingBalance } from "../lib/finance.js";

const paymentSchema = z.object({
  method: z.nativeEnum(PaymentMethod),
  amount: z.number().positive(),
  bank_account_id: z.string().uuid().optional(),
  allocations: z.array(z.object({ invoice_id: z.string().uuid(), amount: z.number().positive() })).min(1),
});

const expenseSchema = z.object({
  category: z.nativeEnum(ExpenseCategory),
  amount: z.number().positive(),
  supplier: z.string().optional(),
  manuscript_id: z.string().uuid().optional(),
  description: z.string().optional(),
});

const budgetSchema = z.object({
  manuscript_id: z.string().uuid().optional(),
  department_id: z.string().uuid().optional(),
  label: z.string().min(1),
  lines: z.array(z.object({ cost_type: z.nativeEnum(CostType), planned_amount: z.number().nonnegative() })).min(1),
});

const bankAccountSchema = z.object({
  label: z.string().min(1),
  is_mobile_money: z.boolean().default(false),
  currency: z.string().default("XOF"),
});

const taxRateSchema = z.object({
  country: z.string().min(1),
  product_type: z.string().min(1),
  rate: z.number().min(0).max(100),
});

// Ch. 18 : Finance et comptabilité — Option B (décision opérateur du
// 04/07/2026) : gestion financière opérationnelle, exports normalisés vers
// un logiciel/cabinet comptable externe (pas de comptabilité générale intégrée).
export default async function financeRoutes(fastify: FastifyInstance) {
  // --- Facturation (Ch. 18 §18.2) ---

  fastify.get("/api/v1/invoices", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const query = request.query as { customer_id?: string; type?: string };
    const invoices = await prisma.invoice.findMany({
      where: {
        ...(query.customer_id ? { customerId: query.customer_id } : {}),
        ...(query.type ? { type: query.type as never } : {}),
      },
      include: { lines: true, customer: true },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(invoices);
  });

  fastify.get("/api/v1/invoices/:id", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { lines: true, customer: true, paymentAllocations: { include: { payment: true } }, creditNotes: true },
    });
    if (!invoice) {
      return reply.code(404).send({ code: "not_found", message: "Facture introuvable." });
    }
    return reply.send(invoice);
  });

  // --- Encaissements et créances (Ch. 18 §18.3) ---

  fastify.post("/api/v1/payments", { preHandler: requirePermission("finance", "saisie") }, async (request, reply) => {
    const parsed = paymentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const body = parsed.data;
    const allocatedTotal = body.allocations.reduce((sum, a) => sum + a.amount, 0);
    if (Math.abs(allocatedTotal - body.amount) > 0.01) {
      return reply.code(400).send({
        code: "validation_error",
        message: "Le total des lettrages doit correspondre au montant du paiement.",
      });
    }

    try {
      const payment = await prisma.$transaction(async (tx) => {
        await assertPeriodOpen(tx);
        const created = await tx.payment.create({
          data: {
            direction: "in",
            method: body.method,
            amount: body.amount,
            bankAccountId: body.bank_account_id,
            createdBy: request.user!.id,
          },
        });
        for (const allocation of body.allocations) {
          await tx.paymentAllocation.create({
            data: { paymentId: created.id, invoiceId: allocation.invoice_id, amount: allocation.amount },
          });
        }
        return created;
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "payment",
        entityId: payment.id,
        newValues: body,
        ipAddress: request.ip,
      });

      return reply.code(201).send(payment);
    } catch (err) {
      if (err instanceof PeriodClosedError) {
        return reply.code(409).send({ code: "accounting_period_closed", message: err.message });
      }
      throw err;
    }
  });

  fastify.get("/api/v1/payments", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const payments = await prisma.payment.findMany({ include: { allocations: true }, orderBy: { receivedAt: "desc" } });
    return reply.send(payments);
  });

  // Ch. 18 §18.3 : créances par ancienneté (non échu / 30 / 60 / 90+ jours).
  fastify.get("/api/v1/customers/:id/aging", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoices = await prisma.invoice.findMany({
      where: { customerId: id, type: "invoice", status: { not: "cancelled" } },
      include: { paymentAllocations: true, creditNotes: true },
    });
    const now = Date.now();
    const buckets = { not_due: 0, d30: 0, d60: 0, d90_plus: 0 };
    for (const invoice of invoices) {
      const allocated = invoice.paymentAllocations.reduce((s, a) => s + Number(a.amount), 0);
      const credited = invoice.creditNotes.reduce((s, c) => s + Number(c.totalTtc), 0);
      const due = Number(invoice.totalTtc) - allocated - credited;
      if (due <= 0) continue;
      const dueDate = invoice.dueDate ?? invoice.createdAt;
      const daysOverdue = (now - dueDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysOverdue <= 0) buckets.not_due += due;
      else if (daysOverdue <= 30) buckets.d30 += due;
      else if (daysOverdue <= 60) buckets.d60 += due;
      else buckets.d90_plus += due;
    }
    return reply.send(buckets);
  });

  // Ch. 18 §18.3 : relances graduées (rappel courtois → mise en demeure),
  // tracées au dossier client. Escalade à deux niveaux ; au-delà de la mise
  // en demeure, la suite (contentieux) sort du périmètre applicatif.
  fastify.post("/api/v1/dunning/:customerId/next", { preHandler: requirePermission("finance", "saisie") }, async (request, reply) => {
    const { customerId } = request.params as { customerId: string };
    const outstanding = await computeCustomerOutstandingBalance(customerId);
    if (outstanding <= 0) {
      return reply.code(409).send({ code: "no_outstanding_balance", message: "Aucun encours à relancer pour ce client." });
    }
    const lastDunning = await prisma.dunning.findFirst({ where: { customerId }, orderBy: { sentAt: "desc" } });
    if (lastDunning?.level === "mise_en_demeure") {
      return reply.code(409).send({
        code: "max_dunning_level_reached",
        message: "La relance a déjà atteint la mise en demeure ; la suite relève du contentieux.",
      });
    }
    const level = lastDunning?.level === "rappel" ? "mise_en_demeure" : "rappel";
    const dunning = await prisma.dunning.create({
      data: { customerId, level, outstandingAmount: outstanding, createdBy: request.user!.id },
    });
    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "dunning",
      entityId: dunning.id,
      newValues: { customerId, level, outstandingAmount: outstanding },
      ipAddress: request.ip,
    });
    return reply.code(201).send(dunning);
  });

  fastify.get("/api/v1/customers/:id/dunning", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const dunnings = await prisma.dunning.findMany({ where: { customerId: id }, orderBy: { sentAt: "desc" } });
    return reply.send(dunnings);
  });

  // --- Dépenses (Ch. 18 §18.4) ---

  fastify.post("/api/v1/expenses", { preHandler: requirePermission("finance", "saisie") }, async (request, reply) => {
    const parsed = expenseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const expense = await prisma.expense.create({
      data: {
        category: parsed.data.category,
        amount: parsed.data.amount,
        supplier: parsed.data.supplier,
        manuscriptId: parsed.data.manuscript_id,
        description: parsed.data.description,
        createdBy: request.user!.id,
      },
    });
    return reply.code(201).send(expense);
  });

  fastify.get("/api/v1/expenses", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const query = request.query as { manuscript_id?: string };
    const expenses = await prisma.expense.findMany({
      where: query.manuscript_id ? { manuscriptId: query.manuscript_id } : {},
      orderBy: { createdAt: "desc" },
    });
    return reply.send(expenses);
  });

  // Séparation des tâches (Ch. 18 §18.11) : celui qui saisit une dépense ne
  // peut pas la valider seul (finance:administration réservé aux profils
  // habilités à double-valider, distinct de finance:saisie).
  fastify.patch(
    "/api/v1/expenses/:id/validate",
    { preHandler: requirePermission("finance", "administration") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const expense = await prisma.expense.findUnique({ where: { id } });
      if (!expense) {
        return reply.code(404).send({ code: "not_found", message: "Dépense introuvable." });
      }
      if (expense.createdBy === request.user!.id) {
        return reply.code(409).send({
          code: "self_validation_forbidden",
          message: "Celui qui saisit une dépense ne peut pas la valider seul (Ch. 18 §18.11).",
        });
      }
      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.expense.update({ where: { id }, data: { status: "validee", approvedBy: request.user!.id } });
        if (result.manuscriptId) {
          await tx.costEntry.create({
            data: {
              manuscriptId: result.manuscriptId,
              costType: mapExpenseCategoryToCostType(result.category),
              sourceType: "expense",
              sourceId: result.id,
              amount: result.amount,
              committed: false,
              expenseId: result.id,
            },
          });
        }
        return result;
      });
      return reply.send(updated);
    },
  );

  // --- Comptabilité analytique par ouvrage (Ch. 18 §18.5) ---

  fastify.get(
    "/api/v1/manuscripts/:id/profitability",
    { preHandler: requirePermission("finance", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const [costEntries, invoiceLines, purchaseOrders] = await Promise.all([
        prisma.costEntry.findMany({ where: { manuscriptId: id } }),
        prisma.invoiceLine.findMany({ where: { isbn: { manuscriptId: id } }, include: { invoice: true } }),
        prisma.purchaseOrder.findMany({ where: { quote: { manuscriptId: id } } }),
      ]);

      const totalCost = costEntries.reduce((sum, c) => sum + Number(c.amount), 0)
        + purchaseOrders.reduce((sum, po) => sum + Number(po.amount), 0);
      const netSales = invoiceLines.reduce((sum, line) => {
        const sign = line.invoice.type === "credit_note" ? -1 : 1;
        return sum + sign * Number(line.lineTotal);
      }, 0);
      const margin = netSales - totalCost;
      const unitsToBreakEven = totalCost > 0 && invoiceLines.length > 0
        ? Math.ceil(totalCost / (netSales / invoiceLines.reduce((s, l) => s + l.quantity, 0) || 1))
        : null;

      return reply.send({
        manuscript_id: id,
        total_cost: Math.round(totalCost * 100) / 100,
        net_sales: Math.round(netSales * 100) / 100,
        margin: Math.round(margin * 100) / 100,
        coverage_ratio: totalCost > 0 ? Math.round((netSales / totalCost) * 10000) / 100 : null,
        units_to_break_even: unitsToBreakEven,
      });
    },
  );

  // --- Budgets (Ch. 18 §18.6) ---

  fastify.post("/api/v1/budgets", { preHandler: requirePermission("finance", "saisie") }, async (request, reply) => {
    const parsed = budgetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const budget = await prisma.budget.create({
      data: {
        manuscriptId: parsed.data.manuscript_id,
        departmentId: parsed.data.department_id,
        label: parsed.data.label,
        createdBy: request.user!.id,
        lines: { create: parsed.data.lines.map((l) => ({ costType: l.cost_type, plannedAmount: l.planned_amount })) },
      },
      include: { lines: true },
    });
    return reply.code(201).send(budget);
  });

  fastify.get(
    "/api/v1/manuscripts/:id/budgets",
    { preHandler: requirePermission("finance", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const budgets = await prisma.budget.findMany({ where: { manuscriptId: id }, include: { lines: true } });
      const costEntries = await prisma.costEntry.findMany({ where: { manuscriptId: id } });

      const withActuals = budgets.map((budget) => ({
        ...budget,
        lines: budget.lines.map((line) => {
          const actual = costEntries.filter((c) => c.costType === line.costType).reduce((s, c) => s + Number(c.amount), 0);
          const planned = Number(line.revisedAmount ?? line.plannedAmount);
          return { ...line, actual_amount: actual, over_budget: actual > planned, variance_pct: planned > 0 ? Math.round(((actual - planned) / planned) * 10000) / 100 : null };
        }),
      }));
      return reply.send(withActuals);
    },
  );

  fastify.patch(
    "/api/v1/budget-lines/:id/revise",
    { preHandler: requirePermission("finance", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const schema = z.object({ revised_amount: z.number().nonnegative(), reason: z.string().min(1) });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const updated = await prisma.budgetLine.update({
        where: { id },
        data: { revisedAmount: parsed.data.revised_amount, revisionReason: parsed.data.reason },
      });
      return reply.send(updated);
    },
  );

  // --- Trésorerie (Ch. 18 §18.8) ---

  fastify.post("/api/v1/bank-accounts", { preHandler: requirePermission("finance", "administration") }, async (request, reply) => {
    const parsed = bankAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const account = await prisma.bankAccount.create({
      data: { label: parsed.data.label, isMobileMoney: parsed.data.is_mobile_money, currency: parsed.data.currency },
    });
    return reply.code(201).send(account);
  });

  fastify.get("/api/v1/bank-accounts", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const accounts = await prisma.bankAccount.findMany();
    return reply.send(accounts);
  });

  fastify.get("/api/v1/treasury-position", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const [accounts, incoming, outgoing] = await Promise.all([
      prisma.bankAccount.findMany(),
      prisma.payment.aggregate({ where: { direction: "in" }, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: { direction: "out" }, _sum: { amount: true } }),
    ]);
    const position = Number(incoming._sum.amount ?? 0) - Number(outgoing._sum.amount ?? 0);
    return reply.send({ accounts, position: Math.round(position * 100) / 100 });
  });

  // Ch. 18 §18.8 : plan de trésorerie prévisionnel — encaissements attendus
  // (factures dues non soldées, échéance = due_date) vs décaissements prévus
  // (dépenses validées non payées, droits d'auteur statués non payés),
  // regroupés en fenêtres de 30 jours sur l'horizon demandé.
  fastify.get("/api/v1/treasury/forecast", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const query = request.query as { horizon?: string };
    const horizonDays = query.horizon ? Number(query.horizon.replace(/[^\d]/g, "")) || 90 : 90;
    const now = new Date();
    const horizonEnd = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);

    const [invoices, expenses, royaltyStatements] = await Promise.all([
      prisma.invoice.findMany({
        where: { type: "invoice", status: { not: "cancelled" } },
        include: { paymentAllocations: true, creditNotes: true },
      }),
      prisma.expense.findMany({ where: { status: "validee" } }),
      prisma.royaltyStatement.findMany({ where: { status: "issued" } }),
    ]);

    const windowCount = Math.ceil(horizonDays / 30);
    const windows = Array.from({ length: windowCount }, (_, i) => ({
      from: new Date(now.getTime() + i * 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      to: new Date(now.getTime() + (i + 1) * 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      expected_inflow: 0,
      expected_outflow: 0,
    }));

    const bucketIndexFor = (date: Date): number | null => {
      if (date < now || date > horizonEnd) return null;
      return Math.min(Math.floor((date.getTime() - now.getTime()) / (30 * 24 * 60 * 60 * 1000)), windowCount - 1);
    };

    for (const invoice of invoices) {
      const allocated = invoice.paymentAllocations.reduce((s, a) => s + Number(a.amount), 0);
      const credited = invoice.creditNotes.reduce((s, c) => s + Number(c.totalTtc), 0);
      const due = Number(invoice.totalTtc) - allocated - credited;
      if (due <= 0) continue;
      const idx = bucketIndexFor(invoice.dueDate ?? invoice.createdAt);
      if (idx !== null) windows[idx].expected_inflow += due;
    }
    for (const expense of expenses) {
      const idx = bucketIndexFor(expense.createdAt);
      if (idx !== null) windows[idx].expected_outflow += Number(expense.amount);
    }
    for (const statement of royaltyStatements) {
      const idx = bucketIndexFor(statement.createdAt);
      if (idx !== null) windows[idx].expected_outflow += Number(statement.balanceDue);
    }

    const currentPosition = await (async () => {
      const [incoming, outgoing] = await Promise.all([
        prisma.payment.aggregate({ where: { direction: "in" }, _sum: { amount: true } }),
        prisma.payment.aggregate({ where: { direction: "out" }, _sum: { amount: true } }),
      ]);
      return Number(incoming._sum.amount ?? 0) - Number(outgoing._sum.amount ?? 0);
    })();

    let runningBalance = currentPosition;
    const forecast = windows.map((w) => {
      runningBalance += w.expected_inflow - w.expected_outflow;
      return {
        ...w,
        expected_inflow: Math.round(w.expected_inflow * 100) / 100,
        expected_outflow: Math.round(w.expected_outflow * 100) / 100,
        projected_balance: Math.round(runningBalance * 100) / 100,
      };
    });
    const lowPoints = forecast.filter((w) => w.projected_balance < 0);

    return reply.send({ current_position: Math.round(currentPosition * 100) / 100, horizon_days: horizonDays, windows: forecast, alert: lowPoints.length > 0 });
  });

  // --- Taxes (Ch. 18 §18.9) ---

  fastify.post("/api/v1/tax-rates", { preHandler: requirePermission("finance", "administration") }, async (request, reply) => {
    const parsed = taxRateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const rate = await prisma.taxRate.upsert({
      where: { country_productType: { country: parsed.data.country, productType: parsed.data.product_type } },
      update: { rate: parsed.data.rate },
      create: { country: parsed.data.country, productType: parsed.data.product_type, rate: parsed.data.rate },
    });
    return reply.code(201).send(rate);
  });

  fastify.get("/api/v1/tax-rates", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const rates = await prisma.taxRate.findMany();
    return reply.send(rates);
  });

  // --- Clôture de période et export comptable (Ch. 18 §18.10-18.11) ---

  fastify.get("/api/v1/accounting/periods", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const periods = await prisma.accountingPeriod.findMany({ orderBy: { periodKey: "desc" } });
    return reply.send(periods);
  });

  fastify.patch(
    "/api/v1/accounting/periods/:periodKey/close",
    { preHandler: requirePermission("finance", "administration") },
    async (request, reply) => {
      const { periodKey } = request.params as { periodKey: string };
      const period = await prisma.accountingPeriod.upsert({
        where: { periodKey },
        update: { status: "closed", closedAt: new Date(), closedBy: request.user!.id },
        create: { periodKey, status: "closed", closedAt: new Date(), closedBy: request.user!.id },
      });
      return reply.send(period);
    },
  );

  // Export normalisé (Option B) : toute facture/paiement de la période s'y
  // retrouve une seule fois — contrôle d'exhaustivité par comptage et checksum.
  fastify.post(
    "/api/v1/accounting/exports",
    { preHandler: requirePermission("finance", "administration") },
    async (request, reply) => {
      const schema = z.object({ period_key: z.string().regex(/^\d{4}-\d{2}$/) });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const [year, month] = parsed.data.period_key.split("-").map(Number);
      const periodStart = new Date(Date.UTC(year, month - 1, 1));
      const periodEnd = new Date(Date.UTC(year, month, 1));

      const [invoices, payments] = await Promise.all([
        prisma.invoice.findMany({ where: { createdAt: { gte: periodStart, lt: periodEnd } } }),
        prisma.payment.findMany({ where: { receivedAt: { gte: periodStart, lt: periodEnd } } }),
      ]);

      const rows = [
        "type,reference,date,montant",
        ...invoices.map((i) => `${i.type},${i.invoiceNumber},${i.createdAt.toISOString()},${i.totalTtc}`),
        ...payments.map((p) => `payment_${p.direction},${p.id},${p.receivedAt.toISOString()},${p.amount}`),
      ];
      const csv = rows.join("\n");
      const checksum = createHashOf(csv);

      const exportRecord = await prisma.accountingExport.create({
        data: {
          periodKey: parsed.data.period_key,
          format: "csv",
          lineCount: rows.length - 1,
          checksum,
          createdBy: request.user!.id,
        },
      });

      return reply.code(201).send({ ...exportRecord, csv });
    },
  );

  fastify.get("/api/v1/accounting/exports", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const exports = await prisma.accountingExport.findMany({ orderBy: { createdAt: "desc" } });
    return reply.send(exports);
  });
}

function mapExpenseCategoryToCostType(category: string): CostType {
  if (category === "prestation") return "editorial_services";
  if (category === "communication") return "promotion";
  return "overhead_allocation";
}

function createHashOf(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
