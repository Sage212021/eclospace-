import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { notifyUsers } from "../lib/notify.js";
import { nextBillingOrderNumber } from "../lib/billingOrderNumber.js";
import { createInvoiceFromBillingOrder } from "../lib/invoicing.js";

// Commandes à facturer (reconfiguration Finance étape 3) — ex. livre scolaire.
// Initiées par le DG / le commercial / la Finance ; la Finance les reçoit et
// établit la facture, avec validation par seuil.

const THRESHOLD_KEY = "finance.validation_threshold";
const DEFAULT_THRESHOLD = 1_000_000; // XAF, modifiable dans les réglages Finance.

async function getThreshold(): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: THRESHOLD_KEY } });
  if (s && typeof s.value === "number") return s.value;
  return DEFAULT_THRESHOLD;
}

async function financeStaffIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { status: "active", deletedAt: null, accountType: "internal", userRoles: { some: { revokedAt: null, role: { rolePermissions: { some: { permission: { module: "finance", action: "saisie" } } } } } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

function orderView(o: { id: string; orderNumber: string; category: string; label: string; amountHt: unknown; taxRate: unknown; status: string; createdAt: Date }, customerName: string) {
  const ht = Number(o.amountHt);
  const rate = Number(o.taxRate);
  return {
    id: o.id,
    reference: o.orderNumber,
    category: o.category,
    label: o.label,
    customer_name: customerName,
    amount_ht: ht,
    tax_rate: rate,
    amount_ttc: Math.round(ht * (1 + rate / 100) * 100) / 100,
    status: o.status,
    created_at: o.createdAt,
  };
}

export default async function billingOrderRoutes(fastify: FastifyInstance) {
  // Création d'une commande à facturer : DG, commercial ou Finance.
  fastify.post("/api/v1/billing-orders", { preHandler: requireAuth }, async (request, reply) => {
    const perms = request.user!.permissions;
    if (!(perms.has("commercial:saisie") || perms.has("commercial:validation") || perms.has("finance:saisie"))) {
      return reply.code(403).send({ code: "forbidden", message: "Réservé à la direction, au commercial ou à la Finance." });
    }
    const parsed = z
      .object({
        customer_id: z.string().uuid(),
        category: z.enum(["livre_scolaire", "autre"]).default("livre_scolaire"),
        label: z.string().min(1).max(200),
        amount_ht: z.number().positive(),
        tax_rate: z.number().min(0).max(100).default(0),
        note: z.string().max(500).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides (client, intitulé, montant)." });
    const customer = await prisma.customer.findFirst({ where: { id: parsed.data.customer_id, deletedAt: null } });
    if (!customer) return reply.code(404).send({ code: "not_found", message: "Client introuvable." });

    const order = await prisma.billingOrder.create({
      data: {
        orderNumber: await nextBillingOrderNumber(),
        customerId: customer.id,
        category: parsed.data.category,
        label: parsed.data.label.trim(),
        amountHt: parsed.data.amount_ht,
        taxRate: parsed.data.tax_rate,
        note: parsed.data.note?.trim() || null,
        initiatedById: request.user!.id,
        createdBy: request.user!.id,
      },
    });
    const staff = await financeStaffIds();
    if (staff.length) {
      await notifyUsers({ userIds: staff, type: "autre", priority: "medium", title: "Commande à facturer", body: `${order.label} — ${customer.name}`, entityType: "billing_order", entityId: order.id }).catch(() => {});
    }
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "billing_order", entityId: order.id, newValues: { orderNumber: order.orderNumber, amountHt: parsed.data.amount_ht }, ipAddress: request.ip });
    return reply.code(201).send(orderView(order, customer.name));
  });

  // File des commandes à facturer (Finance).
  fastify.get("/api/v1/billing-orders", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const q = z.object({ status: z.enum(["pending", "invoiced", "cancelled"]).optional() }).safeParse(request.query);
    const status = q.success ? q.data.status : undefined;
    const orders = await prisma.billingOrder.findMany({
      where: { deletedAt: null, ...(status ? { status } : { status: "pending" }) },
      include: { customer: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return reply.send(orders.map((o) => orderView(o, o.customer.name)));
  });

  // La Finance établit la facture depuis la commande (validation par seuil).
  fastify.post("/api/v1/billing-orders/:id/invoice", { preHandler: requirePermission("finance", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = await prisma.billingOrder.findFirst({ where: { id, deletedAt: null } });
    if (!order) return reply.code(404).send({ code: "not_found", message: "Commande introuvable." });
    if (order.status !== "pending") return reply.code(409).send({ code: "not_pending", message: "Cette commande est déjà facturée ou annulée." });

    const threshold = await getThreshold();
    try {
      const invoice = await prisma.$transaction((tx) => createInvoiceFromBillingOrder(tx, id, threshold));
      await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "invoice", entityId: invoice.id, newValues: { invoiceNumber: invoice.invoiceNumber, fromBillingOrder: order.orderNumber, status: invoice.status }, ipAddress: request.ip });
      return reply.code(201).send({ id: invoice.id, invoice_number: invoice.invoiceNumber, status: invoice.status, total_ttc: Number(invoice.totalTtc), needs_validation: invoice.status === "pending_validation" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur";
      if (msg === "period_closed") return reply.code(409).send({ code: "period_closed", message: "La période comptable est clôturée." });
      throw e;
    }
  });

  // Réglage du seuil de validation (DG / responsable Finance).
  fastify.get("/api/v1/finance/validation-threshold", { preHandler: requirePermission("finance", "consultation") }, async (_request, reply) => {
    return reply.send({ threshold: await getThreshold() });
  });
  fastify.put("/api/v1/finance/validation-threshold", { preHandler: requirePermission("finance", "administration") }, async (request, reply) => {
    const parsed = z.object({ threshold: z.number().min(0) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Seuil invalide." });
    await prisma.setting.upsert({ where: { key: THRESHOLD_KEY }, create: { key: THRESHOLD_KEY, value: parsed.data.threshold, updatedBy: request.user!.id }, update: { value: parsed.data.threshold, updatedBy: request.user!.id } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "setting", entityId: THRESHOLD_KEY, newValues: { threshold: parsed.data.threshold }, ipAddress: request.ip });
    return reply.send({ threshold: parsed.data.threshold });
  });

  // Factures en attente de validation (au-dessus du seuil).
  fastify.get("/api/v1/invoices/pending-validation", { preHandler: requirePermission("finance", "consultation") }, async (_request, reply) => {
    const invoices = await prisma.invoice.findMany({
      where: { status: "pending_validation" },
      include: { customer: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(invoices.map((i) => ({ id: i.id, invoice_number: i.invoiceNumber, customer_name: i.customer.name, total_ttc: Number(i.totalTtc), created_at: i.createdAt })));
  });

  // Validation d'une facture par le DG / responsable Finance → émise.
  fastify.post("/api/v1/invoices/:id/validate", { preHandler: requirePermission("finance", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) return reply.code(404).send({ code: "not_found", message: "Facture introuvable." });
    if (invoice.status !== "pending_validation") return reply.code(409).send({ code: "not_pending", message: "Cette facture n'est pas en attente de validation." });
    await prisma.invoice.update({ where: { id }, data: { status: "issued" } });
    await writeAuditLog({ userId: request.user!.id, action: "validate", entityType: "invoice", entityId: id, oldValues: { status: "pending_validation" }, newValues: { status: "issued" }, ipAddress: request.ip });
    return reply.send({ ok: true, status: "issued" });
  });
}
