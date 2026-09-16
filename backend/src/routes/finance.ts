import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma, PaymentMethodKind, ExpenseCategory, CostType, BankAccountType, ShippingZone } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { assertPeriodOpen, PeriodClosedError, periodKeyFor } from "../lib/accountingPeriod.js";
import { computeCustomerOutstandingBalance } from "../lib/finance.js";
import { SYSCOHADA_ACCOUNTS, JOURNAL_CODES, expenseCategoryToAccount } from "../lib/accountingMapping.js";
import { sendMail, senderIdentity } from "../lib/mailer.js";
import { buildInvoiceEmail } from "../lib/documentEmail.js";

const invoiceEmailSchema = z.object({
  to: z.string().email().optional(),
  message: z.string().max(4000).optional(),
  preview: z.boolean().optional(),
});

const paymentSchema = z.object({
  // Code d'un mode de paiement configurable (validé contre payment_methods).
  method: z.string().min(1),
  reference: z.string().max(120).optional(),
  amount: z.number().positive(),
  bank_account_id: z.string().uuid().optional(),
  allocations: z.array(z.object({ invoice_id: z.string().uuid(), amount: z.number().positive() })).min(1),
});

const paymentMethodSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[a-z0-9_]+$/, "Code en minuscules, chiffres et _ uniquement."),
  label: z.string().trim().min(1).max(80),
  kind: z.nativeEnum(PaymentMethodKind).default("autre"),
  default_account_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().optional(),
});

const scheduleSchema = z.object({
  installments: z
    .array(z.object({ due_date: z.coerce.date(), amount: z.number().positive(), note: z.string().max(200).optional() }))
    .min(1, "Au moins une échéance."),
});

const paymentMethodPatchSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  kind: z.nativeEnum(PaymentMethodKind).optional(),
  active: z.boolean().optional(),
  default_account_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().optional(),
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
  type: z.nativeEnum(BankAccountType).default("banque"),
  currency: z.string().default("XAF"),
});

const taxRateSchema = z.object({
  country: z.string().min(1),
  product_type: z.string().min(1),
  rate: z.number().min(0).max(100),
});

const shippingRateSchema = z.object({
  zone: z.nativeEnum(ShippingZone),
  flat_amount: z.number().nonnegative().optional(),
  per_kg_amount: z.number().nonnegative().optional(),
  free_above_amount: z.number().nonnegative().optional(),
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

  // Envoi d'une facture par e-mail (Phase A) : le corps de l'e-mail EST le
  // document (rendu serveur). `preview` renvoie l'aperçu sans envoyer ; sinon on
  // envoie et on journalise. Réservé à la consultation finance (comme
  // l'impression), chaque envoi étant tracé.
  fastify.post("/api/v1/invoices/:id/email", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = invoiceEmailSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { lines: true, customer: true } });
    if (!invoice) {
      return reply.code(404).send({ code: "not_found", message: "Facture introuvable." });
    }
    const built = buildInvoiceEmail(invoice, parsed.data.message ?? "");

    if (parsed.data.preview) {
      return reply.send({ subject: built.subject, html: built.html, default_to: invoice.customer.email ?? null });
    }

    const to = parsed.data.to?.trim();
    if (!to) {
      return reply.code(400).send({ code: "missing_recipient", message: "Renseignez l'adresse e-mail du destinataire." });
    }
    let sent: boolean;
    try {
      const sender = senderIdentity(request.user!);
      sent = await sendMail({ to, subject: built.subject, text: built.text, html: built.html, ...sender });
    } catch (err) {
      if (err instanceof Error && err.message === "mail_not_configured") {
        return reply.code(503).send({
          code: "mail_not_configured",
          message: "L'envoi d'e-mails n'est pas encore configuré (paramètres SMTP à renseigner sur l'hébergement).",
        });
      }
      throw err;
    }
    await writeAuditLog({
      userId: request.user!.id,
      action: "export",
      entityType: "invoice_email",
      entityId: id,
      newValues: { to, sent },
      ipAddress: request.ip,
    });
    return reply.send({ sent, to });
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

    // Mode de paiement : doit exister et être actif (liste configurable).
    const methodDef = await prisma.paymentMethodDef.findUnique({ where: { code: body.method } });
    if (!methodDef || !methodDef.active) {
      return reply.code(400).send({ code: "invalid_payment_method", message: "Mode de paiement inconnu ou désactivé." });
    }
    // Association automatique au compte financier par défaut du mode, à défaut de choix explicite.
    const bankAccountId = body.bank_account_id ?? methodDef.defaultAccountId ?? null;

    try {
      const settledInvoiceIds: string[] = [];
      const payment = await prisma.$transaction(async (tx) => {
        await assertPeriodOpen(tx);
        const created = await tx.payment.create({
          data: {
            direction: "in",
            method: body.method,
            reference: body.reference,
            amount: body.amount,
            bankAccountId,
            createdBy: request.user!.id,
          },
        });
        for (const allocation of body.allocations) {
          await tx.paymentAllocation.create({
            data: { paymentId: created.id, invoiceId: allocation.invoice_id, amount: allocation.amount },
          });
        }
        // Passage automatique à « Réglée » : quand le solde d'une facture émise
        // atteint 0 (encaissements + avoirs ≥ total TTC), elle bascule sur
        // « paid ». Le reste-à-payer était déjà suivi ; ceci met le STATUT à jour
        // pour que « Réglée » s'affiche et que le bouton « Encaisser » disparaisse.
        const invoiceIds = [...new Set(body.allocations.map((a) => a.invoice_id))];
        for (const invId of invoiceIds) {
          const inv = await tx.invoice.findUnique({ where: { id: invId }, include: { paymentAllocations: true, creditNotes: true } });
          if (!inv || inv.type !== "invoice" || inv.status !== "issued") continue;
          const allocated = inv.paymentAllocations.reduce((s, a) => s + Number(a.amount), 0);
          const credited = inv.creditNotes.reduce((s, c) => s + Number(c.totalTtc), 0);
          const due = Number(inv.totalTtc) - allocated - credited;
          if (due <= 0.01) {
            await tx.invoice.update({ where: { id: invId }, data: { status: "paid" } });
            settledInvoiceIds.push(invId);
          }
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
      // Trace du changement de statut (audit_log) pour chaque facture soldée.
      for (const invId of settledInvoiceIds) {
        await writeAuditLog({
          userId: request.user!.id,
          action: "update",
          entityType: "invoice",
          entityId: invId,
          newValues: { status: "paid", reason: "solde atteint par encaissement" },
          ipAddress: request.ip,
        });
      }

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

  // --- Modes de paiement (paramétrables par l'administrateur) ---------------
  fastify.get("/api/v1/payment-methods", { preHandler: requirePermission("finance", "consultation") }, async (_request, reply) => {
    const methods = await prisma.paymentMethodDef.findMany({ orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
    return reply.send(methods);
  });

  fastify.post("/api/v1/payment-methods", { preHandler: requirePermission("finance", "administration") }, async (request, reply) => {
    const parsed = paymentMethodSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const b = parsed.data;
    const existing = await prisma.paymentMethodDef.findUnique({ where: { code: b.code } });
    if (existing) {
      return reply.code(409).send({ code: "duplicate_code", message: `Le code « ${b.code} » existe déjà.` });
    }
    const method = await prisma.paymentMethodDef.create({
      data: { code: b.code, label: b.label, kind: b.kind, defaultAccountId: b.default_account_id ?? null, sortOrder: b.sort_order ?? 0 },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "payment_method", entityId: method.id, newValues: { code: b.code, label: b.label }, ipAddress: request.ip });
    return reply.code(201).send(method);
  });

  fastify.patch("/api/v1/payment-methods/:id", { preHandler: requirePermission("finance", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = paymentMethodPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const b = parsed.data;
    const method = await prisma.paymentMethodDef.findUnique({ where: { id } });
    if (!method) return reply.code(404).send({ code: "not_found", message: "Mode de paiement introuvable." });
    const updated = await prisma.paymentMethodDef.update({
      where: { id },
      data: {
        ...(b.label !== undefined ? { label: b.label } : {}),
        ...(b.kind !== undefined ? { kind: b.kind } : {}),
        ...(b.active !== undefined ? { active: b.active } : {}),
        ...(b.default_account_id !== undefined ? { defaultAccountId: b.default_account_id } : {}),
        ...(b.sort_order !== undefined ? { sortOrder: b.sort_order } : {}),
      },
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "payment_method", entityId: id, newValues: b as Prisma.InputJsonValue, ipAddress: request.ip });
    return reply.send(updated);
  });

  // --- Échéancier de crédit d'une facture -----------------------------------
  // Définit (remplace) le plan d'échéances d'une facture. Somme des échéances
  // limitée au total TTC (paiement en plusieurs fois).
  fastify.post("/api/v1/invoices/:id/schedule", { preHandler: requirePermission("finance", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = scheduleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) return reply.code(404).send({ code: "not_found", message: "Facture introuvable." });
    const sum = parsed.data.installments.reduce((s, i) => s + i.amount, 0);
    if (sum - Number(invoice.totalTtc) > 0.01) {
      return reply.code(400).send({ code: "schedule_exceeds_total", message: `Le total des échéances (${sum}) dépasse le montant de la facture (${invoice.totalTtc}).` });
    }
    await prisma.$transaction(async (tx) => {
      await tx.installment.deleteMany({ where: { invoiceId: id } });
      let order = 0;
      for (const i of parsed.data.installments.sort((a, b) => a.due_date.getTime() - b.due_date.getTime())) {
        await tx.installment.create({ data: { invoiceId: id, dueDate: i.due_date, amount: i.amount, note: i.note, sortOrder: order++ } });
      }
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "invoice_schedule", entityId: id, newValues: { count: parsed.data.installments.length, total: sum }, ipAddress: request.ip });
    return reply.send(await buildSchedule(id));
  });

  fastify.get("/api/v1/invoices/:id/schedule", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) return reply.code(404).send({ code: "not_found", message: "Facture introuvable." });
    return reply.send(await buildSchedule(id));
  });

  // Rapport d'encaissements : agrégats par mode de paiement, par compte
  // financier (caisse/banque/mobile money) et ventes au comptoir par point de
  // vente — filtrables par période (from/to). Base des rapports demandés.
  fastify.get("/api/v1/finance/payment-report", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const q = request.query as { from?: string; to?: string };
    const range: Prisma.DateTimeFilter = {};
    if (q.from) range.gte = new Date(q.from);
    if (q.to) range.lte = new Date(q.to);
    const hasRange = Boolean(q.from || q.to);
    const paymentWhere = { direction: "in" as const, ...(hasRange ? { receivedAt: range } : {}) };

    const [byMethodRaw, byAccountRaw, methods, accounts, posSales, points] = await Promise.all([
      prisma.payment.groupBy({ by: ["method"], where: paymentWhere, _sum: { amount: true }, _count: true }),
      prisma.payment.groupBy({ by: ["bankAccountId"], where: paymentWhere, _sum: { amount: true }, _count: true }),
      prisma.paymentMethodDef.findMany(),
      prisma.bankAccount.findMany(),
      prisma.posSale.findMany({ where: { ...(hasRange ? { soldAt: range } : {}), cancelledAt: null }, select: { pointOfSaleId: true, quantity: true, unitPrice: true } }),
      prisma.pointOfSale.findMany(),
    ]);

    const methodLabel = new Map(methods.map((m) => [m.code, m.label]));
    const accountLabel = new Map(accounts.map((a) => [a.id, a.label]));
    const pointLabel = new Map(points.map((p) => [p.id, p.name]));

    const byMethod = byMethodRaw.map((r) => ({ method: r.method, label: methodLabel.get(r.method) ?? r.method, total: Number(r._sum.amount ?? 0), count: r._count }));
    const byAccount = byAccountRaw.map((r) => ({ account_id: r.bankAccountId, label: r.bankAccountId ? accountLabel.get(r.bankAccountId) ?? "Compte" : "(non affecté)", total: Number(r._sum.amount ?? 0), count: r._count }));

    const posMap = new Map<string, { total: number; count: number }>();
    for (const s of posSales) {
      const key = s.pointOfSaleId ?? "__none__";
      const cur = posMap.get(key) ?? { total: 0, count: 0 };
      cur.total += Number(s.unitPrice) * s.quantity;
      cur.count += 1;
      posMap.set(key, cur);
    }
    const byPointOfSale = [...posMap.entries()].map(([key, v]) => ({ point_of_sale_id: key === "__none__" ? null : key, name: key === "__none__" ? "(non précisé)" : pointLabel.get(key) ?? "Point de vente", total: v.total, count: v.count }));

    const totalIn = byMethod.reduce((s, m) => s + m.total, 0);
    return reply.send({ from: q.from ?? null, to: q.to ?? null, total_in: totalIn, by_method: byMethod, by_account: byAccount, by_point_of_sale: byPointOfSale });
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
    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "expense",
      entityId: expense.id,
      newValues: expense,
      ipAddress: request.ip,
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

  // Séparation des tâches (Ch. 18 §18.11) — décision opérateur (13/09/2026,
  // précisée le 16/09/2026) : TOUTE dépense d'ouvrage est validée par DEUX
  // personnes, quel que soit le montant.
  //   Palier 1 — la Finance (DAF, finance:administration) valide → statut
  //              « en_attente_dg », on mémorise le premier validateur.
  //   Palier 2 — la Direction générale (rôle DIR_GENERAL) valide en dernier →
  //              statut « validee » ; ce doit être une personne DISTINCTE du
  //              premier validateur.
  // Il n'y a donc plus de seuil : le DG valide systématiquement. La dépense
  // n'est comptée au bilan (statut « validee »/« payee ») qu'après la double
  // validation. Simplification documentée : un vrai circuit « demandeur →
  // responsable hiérarchique → DAF → DG » suppose un organigramme (Ch. 19,
  // Lot 6) qui n'existe pas encore.
  fastify.patch(
    "/api/v1/expenses/:id/validate",
    { preHandler: requirePermission("finance", "administration") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const expense = await prisma.expense.findUnique({ where: { id } });
      if (!expense) {
        return reply.code(404).send({ code: "not_found", message: "Dépense introuvable." });
      }

      // Palier 1 : validation de la Finance (DAF). Toute dépense passe par la
      // Direction générale ensuite, quel que soit le montant.
      if (expense.status === "a_valider") {
        const updated = await prisma.expense.update({
          where: { id },
          data: { status: "en_attente_dg", financeValidatedBy: request.user!.id },
        });
        await writeAuditLog({
          userId: request.user!.id,
          action: "update",
          entityType: "expense",
          entityId: id,
          newValues: { status: "en_attente_dg" },
          ipAddress: request.ip,
        });
        return reply.send(updated);
      }

      // Palier 2 : validation finale, réservée à la Direction générale, par une
      // personne distincte du premier validateur.
      if (expense.status === "en_attente_dg") {
        if (!request.user!.roles.includes("DIR_GENERAL")) {
          return reply.code(403).send({
            code: "dg_approval_required",
            message: "La validation finale d'une dépense est réservée à la Direction générale.",
          });
        }
        if (expense.financeValidatedBy === request.user!.id) {
          return reply.code(409).send({
            code: "self_validation_forbidden",
            message: "Celui qui a effectué la première validation ne peut pas aussi être le validateur final.",
          });
        }
        const updated = await validateExpenseAndPostCostEntry(id, request.user!.id);
        await writeAuditLog({
          userId: request.user!.id,
          action: "update",
          entityType: "expense",
          entityId: id,
          newValues: { status: "validee" },
          ipAddress: request.ip,
        });
        return reply.send(updated);
      }

      return reply.code(409).send({ code: "invalid_transition", message: "Cette dépense n'est pas en attente de validation." });
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
    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "budget",
      entityId: budget.id,
      newValues: budget,
      ipAddress: request.ip,
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
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "budget_line",
        entityId: id,
        newValues: { revisedAmount: parsed.data.revised_amount, revisionReason: parsed.data.reason },
        ipAddress: request.ip,
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
      data: { label: parsed.data.label, type: parsed.data.type, currency: parsed.data.currency },
    });
    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "bank_account",
      entityId: account.id,
      newValues: account,
      ipAddress: request.ip,
    });
    return reply.code(201).send(account);
  });

  fastify.get("/api/v1/bank-accounts", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const accounts = await prisma.bankAccount.findMany();
    return reply.send(accounts);
  });

  // Bilan mensuel de trésorerie (demande direction, 09/09/2026) : pour une année,
  // Total ENTRÉES (encaissements = paiements « in », par date d'encaissement) −
  // Total DÉPENSES (module Dépenses, statuts VALIDÉE + PAYÉE, par date de saisie)
  // = SOLDE, mois par mois + cumul annuel. Alimenté par les opérations déjà
  // enregistrées (aucune ressaisie). Le détail des dépenses par catégorie est
  // fourni pour chaque mois.
  fastify.get("/api/v1/finance/monthly-balance", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const q = request.query as { year?: string };
    const year = q.year && /^\d{4}$/.test(q.year) ? Number(q.year) : new Date().getUTCFullYear();
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));

    const [incomes, expenses, outPayments] = await Promise.all([
      prisma.payment.findMany({ where: { direction: "in", receivedAt: { gte: start, lt: end } }, select: { amount: true, receivedAt: true } }),
      prisma.expense.findMany({ where: { status: { in: ["validee", "payee"] }, createdAt: { gte: start, lt: end } }, select: { amount: true, category: true, createdAt: true } }),
      // Décaissements réels passés par la trésorerie (paiements « out ») : droits
      // d'auteur versés, etc. Ils réduisent la trésorerie au même titre que les
      // dépenses, mais ne sont PAS des `Expense` — sans eux, le bilan ne comptait
      // que les entrées et une partie des sorties (signalé par la Finance, 12/09/2026).
      prisma.payment.findMany({ where: { direction: "out", receivedAt: { gte: start, lt: end } }, select: { amount: true, receivedAt: true } }),
    ]);

    const months = Array.from({ length: 12 }, (_, m) => ({
      month: m + 1,
      entrees: 0,
      depenses: 0,
      solde: 0,
      depensesParCategorie: {} as Record<string, number>,
    }));

    for (const p of incomes) {
      months[p.receivedAt.getUTCMonth()].entrees += Number(p.amount);
    }
    for (const e of expenses) {
      const row = months[e.createdAt.getUTCMonth()];
      const amt = Number(e.amount);
      row.depenses += amt;
      row.depensesParCategorie[e.category] = (row.depensesParCategorie[e.category] ?? 0) + amt;
    }
    for (const p of outPayments) {
      const row = months[p.receivedAt.getUTCMonth()];
      const amt = Number(p.amount);
      row.depenses += amt;
      row.depensesParCategorie["droits_auteur"] = (row.depensesParCategorie["droits_auteur"] ?? 0) + amt;
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    for (const m of months) {
      m.entrees = round(m.entrees);
      m.depenses = round(m.depenses);
      m.solde = round(m.entrees - m.depenses);
      for (const k of Object.keys(m.depensesParCategorie)) m.depensesParCategorie[k] = round(m.depensesParCategorie[k]);
    }
    const totals = {
      entrees: round(months.reduce((s, m) => s + m.entrees, 0)),
      depenses: round(months.reduce((s, m) => s + m.depenses, 0)),
      solde: round(months.reduce((s, m) => s + m.solde, 0)),
    };
    return reply.send({ year, months, totals });
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

  // Solde par compte/caisse (Ch. 18 §18.8) : paiements externes reçus/versés
  // sur ce compte, plus les virements internes entrants moins sortants.
  fastify.get("/api/v1/bank-accounts/:id/balance", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [incoming, outgoing, transfersIn, transfersOut] = await Promise.all([
      prisma.payment.aggregate({ where: { bankAccountId: id, direction: "in" }, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: { bankAccountId: id, direction: "out" }, _sum: { amount: true } }),
      prisma.accountTransfer.aggregate({ where: { toAccountId: id }, _sum: { amount: true } }),
      prisma.accountTransfer.aggregate({ where: { fromAccountId: id }, _sum: { amount: true } }),
    ]);
    const balance =
      Number(incoming._sum.amount ?? 0) -
      Number(outgoing._sum.amount ?? 0) +
      Number(transfersIn._sum.amount ?? 0) -
      Number(transfersOut._sum.amount ?? 0);
    return reply.send({ account_id: id, balance: Math.round(balance * 100) / 100 });
  });

  // Virement interne entre deux comptes/caisses propres à la maison (Ch. 18
  // §18.8) : ne modifie pas la position de trésorerie globale, seulement la
  // répartition entre comptes.
  fastify.post("/api/v1/account-transfers", { preHandler: requirePermission("finance", "administration") }, async (request, reply) => {
    const schema = z.object({
      from_account_id: z.string().uuid(),
      to_account_id: z.string().uuid(),
      amount: z.number().positive(),
      reason: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    if (parsed.data.from_account_id === parsed.data.to_account_id) {
      return reply.code(400).send({ code: "validation_error", message: "Le compte source et le compte destination doivent être différents." });
    }
    const transfer = await prisma.accountTransfer.create({
      data: {
        fromAccountId: parsed.data.from_account_id,
        toAccountId: parsed.data.to_account_id,
        amount: parsed.data.amount,
        reason: parsed.data.reason,
        createdBy: request.user!.id,
      },
    });
    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "account_transfer",
      entityId: transfer.id,
      newValues: transfer,
      ipAddress: request.ip,
    });
    return reply.code(201).send(transfer);
  });

  fastify.get("/api/v1/account-transfers", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const transfers = await prisma.accountTransfer.findMany({ orderBy: { transferredAt: "desc" } });
    return reply.send(transfers);
  });

  // Rapprochement bancaire assisté (Ch. 18 §18.8) : import des lignes d'un
  // relevé (saisie/import JSON — aucun format de relevé bancaire spécifique
  // n'est imposé par un partenaire, donc pas de parseur CSV dédié pour
  // l'instant) puis pointage ligne à ligne avec un encaissement/décaissement.
  fastify.post("/api/v1/bank-accounts/:id/statements", { preHandler: requirePermission("finance", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const schema = z.object({
      period_start: z.string().datetime(),
      period_end: z.string().datetime(),
      lines: z.array(z.object({ transaction_date: z.string().datetime(), label: z.string().min(1), amount: z.number() })).min(1),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const statement = await prisma.bankStatement.create({
      data: {
        bankAccountId: id,
        periodStart: new Date(parsed.data.period_start),
        periodEnd: new Date(parsed.data.period_end),
        lines: {
          create: parsed.data.lines.map((l) => ({
            transactionDate: new Date(l.transaction_date),
            label: l.label,
            amount: l.amount,
          })),
        },
      },
      include: { lines: true },
    });
    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "bank_statement",
      entityId: statement.id,
      newValues: { bankAccountId: id, lineCount: statement.lines.length },
      ipAddress: request.ip,
    });
    return reply.code(201).send(statement);
  });

  fastify.get("/api/v1/bank-accounts/:id/statements", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const statements = await prisma.bankStatement.findMany({ where: { bankAccountId: id }, include: { lines: true }, orderBy: { periodStart: "desc" } });
    return reply.send(statements);
  });

  fastify.patch(
    "/api/v1/statement-lines/:id/match",
    { preHandler: requirePermission("finance", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const schema = z.object({ payment_id: z.string().uuid() });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const line = await prisma.statementLine.findUnique({ where: { id } });
      if (!line) {
        return reply.code(404).send({ code: "not_found", message: "Ligne de relevé introuvable." });
      }
      if (line.reconciledAt) {
        return reply.code(409).send({ code: "already_reconciled", message: "Cette ligne est déjà pointée." });
      }
      try {
        const updated = await prisma.statementLine.update({
          where: { id },
          data: { matchedPaymentId: parsed.data.payment_id, reconciledAt: new Date() },
        });
        await writeAuditLog({
          userId: request.user!.id,
          action: "update",
          entityType: "statement_line",
          entityId: id,
          newValues: { matchedPaymentId: parsed.data.payment_id },
          ipAddress: request.ip,
        });
        return reply.send(updated);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          return reply.code(409).send({ code: "payment_already_matched", message: "Ce paiement est déjà pointé sur une autre ligne de relevé." });
        }
        throw err;
      }
    },
  );

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
    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "tax_rate",
      entityId: rate.id,
      newValues: rate,
      ipAddress: request.ip,
    });
    return reply.code(201).send(rate);
  });

  fastify.get("/api/v1/tax-rates", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const rates = await prisma.taxRate.findMany();
    return reply.send(rates);
  });

  // --- Frais de port (Ch. 17 §17.5, ajouté hors cahier des charges initial) ---

  fastify.post("/api/v1/shipping-rates", { preHandler: requirePermission("finance", "administration") }, async (request, reply) => {
    const parsed = shippingRateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const rate = await prisma.shippingRate.upsert({
      where: { zone: parsed.data.zone },
      update: {
        flatAmount: parsed.data.flat_amount,
        perKgAmount: parsed.data.per_kg_amount,
        freeAboveAmount: parsed.data.free_above_amount,
        updatedBy: request.user!.id,
      },
      create: {
        zone: parsed.data.zone,
        flatAmount: parsed.data.flat_amount,
        perKgAmount: parsed.data.per_kg_amount,
        freeAboveAmount: parsed.data.free_above_amount,
        updatedBy: request.user!.id,
      },
    });
    await writeAuditLog({
      userId: request.user!.id,
      action: "update",
      entityType: "shipping_rate",
      entityId: rate.id,
      newValues: rate,
      ipAddress: request.ip,
    });
    return reply.code(201).send(rate);
  });

  fastify.get("/api/v1/shipping-rates", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const rates = await prisma.shippingRate.findMany();
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
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "accounting_period",
        entityId: period.id,
        newValues: { periodKey, status: "closed" },
        ipAddress: request.ip,
      });
      return reply.send(period);
    },
  );

  // Export normalisé (Option B) : toute facture/paiement/dépense validée/droit
  // d'auteur versé de la période s'y retrouve une seule fois — contrôle
  // d'exhaustivité par comptage et checksum. Colonnes compte/journal/
  // analytique/pièce ajoutées pour une importation directe dans un logiciel
  // comptable externe (Sage, Odoo, SAP, Excel) — plan de comptes indicatif
  // (cf. lib/accountingMapping.ts), À VALIDER PAR LE COMPTABLE avant tout
  // dépôt réel.
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

      // Les droits d'auteur versés (royalty_payments) référencent un Payment
      // déjà compté ci-dessous via la requête `payments` — ne pas les
      // interroger séparément sous peine de compter deux fois le même
      // mouvement de trésorerie (contrôle d'exhaustivité : chaque opération
      // une seule fois).
      const [invoices, payments, expenses] = await Promise.all([
        prisma.invoice.findMany({ where: { createdAt: { gte: periodStart, lt: periodEnd } } }),
        prisma.payment.findMany({ where: { receivedAt: { gte: periodStart, lt: periodEnd } }, include: { bankAccount: true, royaltyPayment: true } }),
        prisma.expense.findMany({ where: { createdAt: { gte: periodStart, lt: periodEnd }, status: { in: ["validee", "payee"] } } }),
      ]);

      // Écritures en partie double simplifiée (compte_debit / compte_credit) :
      // la TVA n'est pas isolée sur son propre compte (4431) — elle reste
      // incluse dans le montant TTC du compte de ventes — simplification
      // documentée, à corriger avec le comptable si l'export doit s'intégrer
      // directement dans un grand livre sans retraitement.
      const rows = [
        "type,reference,date,montant,compte_debit,compte_credit,journal,centre_analytique,piece",
        ...invoices.map((i) =>
          [
            i.type,
            i.invoiceNumber,
            i.createdAt.toISOString(),
            i.totalTtc,
            i.type === "credit_note" ? SYSCOHADA_ACCOUNTS.ventesMarchandises : SYSCOHADA_ACCOUNTS.clients,
            i.type === "credit_note" ? SYSCOHADA_ACCOUNTS.clients : SYSCOHADA_ACCOUNTS.ventesMarchandises,
            i.type === "credit_note" ? JOURNAL_CODES.avoirs : JOURNAL_CODES.ventes,
            "",
            i.invoiceNumber,
          ].join(","),
        ),
        ...payments.map((p) => {
          const treasuryAccount = p.bankAccount?.type === "caisse" ? SYSCOHADA_ACCOUNTS.caisse : SYSCOHADA_ACCOUNTS.banque;
          const counterpartAccount = p.royaltyPayment
            ? SYSCOHADA_ACCOUNTS.droitsAuteur
            : p.direction === "in"
              ? SYSCOHADA_ACCOUNTS.clients
              : SYSCOHADA_ACCOUNTS.fournisseurs;
          return [
            `payment_${p.direction}`,
            p.id,
            p.receivedAt.toISOString(),
            p.amount,
            p.direction === "in" ? treasuryAccount : counterpartAccount,
            p.direction === "in" ? counterpartAccount : treasuryAccount,
            p.bankAccount?.type === "caisse" ? JOURNAL_CODES.caisse : JOURNAL_CODES.banque,
            "",
            p.id,
          ].join(",");
        }),
        ...expenses.map((e) =>
          [
            "expense",
            e.id,
            e.createdAt.toISOString(),
            e.amount,
            expenseCategoryToAccount(e.category),
            SYSCOHADA_ACCOUNTS.fournisseurs,
            JOURNAL_CODES.operationsDiverses,
            e.manuscriptId ?? "",
            e.id,
          ].join(","),
        ),
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
      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "accounting_export",
        entityId: exportRecord.id,
        newValues: { periodKey: exportRecord.periodKey, lineCount: exportRecord.lineCount, checksum: exportRecord.checksum },
        ipAddress: request.ip,
      });

      return reply.code(201).send({ ...exportRecord, csv, chart_of_accounts_status: "indicatif_non_valide" });
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

async function validateExpenseAndPostCostEntry(id: string, approvedBy: string) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.expense.update({ where: { id }, data: { status: "validee", approvedBy } });
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
}

function createHashOf(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// Échéancier enrichi : chaque échéance reçoit un statut à partir du cumul
// planifié et du montant déjà réglé (allocations), avec repérage des retards.
async function buildSchedule(invoiceId: string) {
  const [invoice, installments, alloc] = await Promise.all([
    prisma.invoice.findUnique({ where: { id: invoiceId } }),
    prisma.installment.findMany({ where: { invoiceId }, orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }] }),
    prisma.paymentAllocation.aggregate({ where: { invoiceId }, _sum: { amount: true } }),
  ]);
  const settled = Number(alloc._sum.amount ?? 0);
  const now = new Date();
  let cumulative = 0;
  const rows = installments.map((i) => {
    const start = cumulative;
    cumulative += Number(i.amount);
    let status: "paid" | "partial" | "pending" | "overdue";
    if (settled >= cumulative - 0.01) status = "paid";
    else if (settled > start + 0.01) status = "partial";
    else status = "pending";
    if (status !== "paid" && i.dueDate < now) status = "overdue";
    return { id: i.id, due_date: i.dueDate, amount: Number(i.amount), note: i.note, status };
  });
  return { invoice_id: invoiceId, total_ttc: Number(invoice?.totalTtc ?? 0), settled, planned: cumulative, installments: rows };
}
