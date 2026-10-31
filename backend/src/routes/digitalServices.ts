import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { computeServiceView } from "../lib/digitalServices.js";

// Module « Veille des abonnements & paiements numériques » — RÉSERVÉ à
// l'administrateur (permission `abonnements`, que seul l'ADMIN_GENERAL possède).
// On ne stocke JAMAIS de secret bancaire (carte, CVV) : seulement montants,
// dates, références, statuts et URLs de facturation. Chaque modification est
// tracée au journal d'audit. La veille automatique (alertes J-15…dépassé,
// 70/85/95 %) est ajoutée en Phase B.

const KINDS = ["subscription_monthly", "usage_based"] as const;
const PAYMENT_STATUS = ["confirmed", "pending"] as const;

const serviceCreateSchema = z.object({
  key: z.string().trim().min(2).max(60).regex(/^[a-z0-9_]+$/, "clé en minuscules/chiffres/underscore"),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  kind: z.enum(KINDS).optional(),
  billing_url: z.string().trim().url().max(500).optional().nullable(),
  billing_label: z.string().trim().max(120).optional().nullable(),
  currency: z.string().trim().max(8).optional(),
  next_due_date: z.string().datetime().optional().nullable(),
  monthly_budget: z.number().nonnegative().optional().nullable(),
  current_usage: z.number().nonnegative().optional().nullable(),
  usage_period: z.string().trim().max(10).optional().nullable(),
  active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});
const serviceUpdateSchema = serviceCreateSchema.partial().omit({ key: true });

const paymentSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().trim().max(8).optional(),
  paid_at: z.string().datetime(),
  reference: z.string().trim().max(120).optional().nullable(),
  method: z.string().trim().max(60).optional().nullable(),
  status: z.enum(PAYMENT_STATUS).optional(),
  new_due_date: z.string().datetime().optional().nullable(),
  receipt_document_id: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
});

function serviceView(s: {
  id: string; key: string; name: string; description: string | null; kind: string;
  billingUrl: string | null; billingLabel: string | null; currency: string; nextDueDate: Date | null;
  monthlyBudget: unknown; currentUsage: unknown; usagePeriod: string | null; active: boolean; sortOrder: number;
}) {
  const view = computeServiceView({ nextDueDate: s.nextDueDate, kind: s.kind, monthlyBudget: s.monthlyBudget as never, currentUsage: s.currentUsage as never });
  return {
    id: s.id, key: s.key, name: s.name, description: s.description, kind: s.kind,
    billing_url: s.billingUrl, billing_label: s.billingLabel, currency: s.currency,
    next_due_date: s.nextDueDate, monthly_budget: s.monthlyBudget == null ? null : Number(s.monthlyBudget),
    current_usage: s.currentUsage == null ? null : Number(s.currentUsage), usage_period: s.usagePeriod,
    active: s.active, sort_order: s.sortOrder,
    status: view.status, days_to_due: view.daysToDue, usage_pct: view.usagePct,
  };
}

export default async function digitalServiceRoutes(fastify: FastifyInstance) {
  // Liste des services + compteurs (suivis / à surveiller / en retard).
  fastify.get("/api/v1/digital-services", { preHandler: requirePermission("abonnements", "consultation") }, async (_request, reply) => {
    const rows = await prisma.digitalService.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    const services = rows.map(serviceView);
    const active = services.filter((s) => s.active);
    const summary = {
      total: active.length,
      to_watch: active.filter((s) => s.status === "a_surveiller").length,
      late: active.filter((s) => s.status === "en_retard").length,
    };
    return reply.send({ services, summary });
  });

  fastify.post("/api/v1/digital-services", { preHandler: requirePermission("abonnements", "administration") }, async (request, reply) => {
    const parsed = serviceCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const d = parsed.data;
    const exists = await prisma.digitalService.findFirst({ where: { key: d.key, deletedAt: null }, select: { id: true } });
    if (exists) return reply.code(409).send({ code: "duplicate_key", message: `Un service « ${d.key} » existe déjà.` });
    const created = await prisma.digitalService.create({
      data: {
        key: d.key, name: d.name, description: d.description ?? null, kind: d.kind ?? "subscription_monthly",
        billingUrl: d.billing_url ?? null, billingLabel: d.billing_label ?? null, currency: d.currency ?? "FCFA",
        nextDueDate: d.next_due_date ? new Date(d.next_due_date) : null,
        monthlyBudget: d.monthly_budget ?? null, currentUsage: d.current_usage ?? null, usagePeriod: d.usage_period ?? null,
        active: d.active ?? true, sortOrder: d.sort_order ?? 0, createdBy: request.user!.id, updatedBy: request.user!.id,
      },
    });
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "digital_service", entityId: created.id, newValues: { key: created.key, name: created.name }, ipAddress: request.ip });
    return reply.code(201).send(serviceView(created));
  });

  fastify.patch("/api/v1/digital-services/:id", { preHandler: requirePermission("abonnements", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = serviceUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const service = await prisma.digitalService.findFirst({ where: { id, deletedAt: null } });
    if (!service) return reply.code(404).send({ code: "not_found", message: "Service introuvable." });
    const d = parsed.data;
    const updated = await prisma.digitalService.update({
      where: { id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.description !== undefined ? { description: d.description } : {}),
        ...(d.kind !== undefined ? { kind: d.kind } : {}),
        ...(d.billing_url !== undefined ? { billingUrl: d.billing_url } : {}),
        ...(d.billing_label !== undefined ? { billingLabel: d.billing_label } : {}),
        ...(d.currency !== undefined ? { currency: d.currency } : {}),
        ...(d.next_due_date !== undefined ? { nextDueDate: d.next_due_date ? new Date(d.next_due_date) : null } : {}),
        ...(d.monthly_budget !== undefined ? { monthlyBudget: d.monthly_budget } : {}),
        ...(d.current_usage !== undefined ? { currentUsage: d.current_usage } : {}),
        ...(d.usage_period !== undefined ? { usagePeriod: d.usage_period } : {}),
        ...(d.active !== undefined ? { active: d.active } : {}),
        ...(d.sort_order !== undefined ? { sortOrder: d.sort_order } : {}),
        updatedBy: request.user!.id,
      },
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "digital_service", entityId: id, newValues: JSON.parse(JSON.stringify(d)), ipAddress: request.ip });
    return reply.send(serviceView(updated));
  });

  fastify.delete("/api/v1/digital-services/:id", { preHandler: requirePermission("abonnements", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const service = await prisma.digitalService.findFirst({ where: { id, deletedAt: null }, select: { id: true, name: true } });
    if (!service) return reply.code(404).send({ code: "not_found", message: "Service introuvable." });
    await prisma.digitalService.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: request.user!.id } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "digital_service", entityId: id, newValues: { deleted: true, name: service.name }, ipAddress: request.ip });
    return reply.send({ removed: true });
  });

  // Historique des paiements d'un service.
  fastify.get("/api/v1/digital-services/:id/payments", { preHandler: requirePermission("abonnements", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const payments = await prisma.digitalServicePayment.findMany({ where: { serviceId: id, deletedAt: null }, orderBy: { paidAt: "desc" } });
    return reply.send(payments.map((p) => ({
      id: p.id, amount: Number(p.amount), currency: p.currency, paid_at: p.paidAt, reference: p.reference,
      method: p.method, status: p.status, new_due_date: p.newDueDate, receipt_document_id: p.receiptDocumentId, note: p.note, created_at: p.createdAt,
    })));
  });

  // Enregistrer un paiement. Un paiement CONFIRMÉ qui porte une nouvelle échéance
  // met à jour l'échéance du service (c'est la seule façon de « valider » une
  // échéance : jamais un simple clic sur le lien externe).
  fastify.post("/api/v1/digital-services/:id/payments", { preHandler: requirePermission("abonnements", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = paymentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const service = await prisma.digitalService.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!service) return reply.code(404).send({ code: "not_found", message: "Service introuvable." });
    const d = parsed.data;
    const status = d.status ?? "confirmed";
    const payment = await prisma.digitalServicePayment.create({
      data: {
        serviceId: id, amount: d.amount, currency: d.currency ?? "FCFA", paidAt: new Date(d.paid_at),
        reference: d.reference ?? null, method: d.method ?? null, status,
        newDueDate: d.new_due_date ? new Date(d.new_due_date) : null, receiptDocumentId: d.receipt_document_id ?? null,
        note: d.note ?? null, createdBy: request.user!.id,
      },
    });
    // Seul un paiement CONFIRMÉ avance l'échéance du service.
    if (status === "confirmed" && d.new_due_date) {
      await prisma.digitalService.update({ where: { id }, data: { nextDueDate: new Date(d.new_due_date), updatedBy: request.user!.id } });
    }
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "digital_service_payment", entityId: payment.id, newValues: { serviceId: id, amount: d.amount, status }, ipAddress: request.ip });
    return reply.code(201).send({ id: payment.id, status });
  });
}
