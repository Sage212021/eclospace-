import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { notifyUsers } from "../lib/notify.js";
import { nextBillingOrderNumber } from "../lib/billingOrderNumber.js";
import { createInvoiceFromBillingOrder, createCreditNoteFromInvoice } from "../lib/invoicing.js";

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

// Personnel FINANCIER opérationnel : comptes internes actifs dont un rôle porte
// finance:saisie. On EXCLUT l'administrateur général : il détient toutes les
// permissions (dont finance:saisie) mais n'est pas un financier — il ne doit
// pas recevoir les notifications opérationnelles du pôle Finance.
async function financeStaffIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: {
      status: "active",
      deletedAt: null,
      accountType: "internal",
      userRoles: { some: { revokedAt: null, role: { rolePermissions: { some: { permission: { module: "finance", action: "saisie" } } } } } },
      NOT: { userRoles: { some: { revokedAt: null, role: { code: "ADMIN_GENERAL" } } } },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// Décideurs habilités à VALIDER une annulation de facture : titulaires de
// finance:administration (DG / responsable Finance). Même exclusion de
// l'administrateur général que pour les notifications opérationnelles.
async function financeAdminIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: {
      status: "active",
      deletedAt: null,
      accountType: "internal",
      userRoles: { some: { revokedAt: null, role: { rolePermissions: { some: { permission: { module: "finance", action: "administration" } } } } } },
      NOT: { userRoles: { some: { revokedAt: null, role: { code: "ADMIN_GENERAL" } } } },
    },
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
        // Montant global (mode simple) OU détail par ouvrage (mode livre scolaire,
        // qui déclenche le calcul des droits d'auteur). Au moins l'un des deux.
        amount_ht: z.number().positive().optional(),
        tax_rate: z.number().min(0).max(100).default(0),
        note: z.string().max(500).optional(),
        lines: z
          .array(
            z.object({
              isbn_id: z.string().uuid().optional(),
              description: z.string().min(1).max(200),
              quantity: z.number().int().positive(),
              unit_price_ht: z.number().positive(),
              // Taux de droits spécifique (0–100 %) ; sinon le taux maison s'applique.
              royalty_rate: z.number().min(0).max(1).optional(),
            }),
          )
          .max(200)
          .optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides (client, intitulé, montant ou lignes)." });
    const { lines } = parsed.data;
    if (!lines?.length && parsed.data.amount_ht == null) {
      return reply.code(400).send({ code: "validation_error", message: "Renseignez un montant global ou au moins une ligne d'ouvrage." });
    }
    const customer = await prisma.customer.findFirst({ where: { id: parsed.data.customer_id, deletedAt: null } });
    if (!customer) return reply.code(404).send({ code: "not_found", message: "Client introuvable." });

    // Contrôle des ISBN fournis (doivent exister) — segmentation fiable des droits.
    if (lines?.length) {
      const isbnIds = [...new Set(lines.map((l) => l.isbn_id).filter((v): v is string => !!v))];
      if (isbnIds.length) {
        const found = await prisma.isbn.count({ where: { id: { in: isbnIds } } });
        if (found !== isbnIds.length) return reply.code(400).send({ code: "validation_error", message: "Un ISBN référencé est introuvable." });
      }
    }

    // Montant HT : somme des lignes si détaillé, sinon le montant global saisi.
    const amountHt = lines?.length ? Math.round(lines.reduce((s, l) => s + l.quantity * l.unit_price_ht, 0) * 100) / 100 : parsed.data.amount_ht!;

    const order = await prisma.billingOrder.create({
      data: {
        orderNumber: await nextBillingOrderNumber(),
        customerId: customer.id,
        category: parsed.data.category,
        label: parsed.data.label.trim(),
        amountHt,
        taxRate: parsed.data.tax_rate,
        note: parsed.data.note?.trim() || null,
        initiatedById: request.user!.id,
        createdBy: request.user!.id,
        ...(lines?.length
          ? {
              lines: {
                create: lines.map((l) => ({
                  isbnId: l.isbn_id ?? undefined,
                  description: l.description.trim(),
                  quantity: l.quantity,
                  unitPriceHt: l.unit_price_ht,
                  royaltyRate: l.royalty_rate ?? undefined,
                })),
              },
            }
          : {}),
      },
    });
    const staff = await financeStaffIds();
    if (staff.length) {
      await notifyUsers({ userIds: staff, type: "autre", priority: "medium", title: "Commande à facturer", body: `${order.label} — ${customer.name}`, entityType: "billing_order", entityId: order.id }).catch(() => {});
    }
    await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "billing_order", entityId: order.id, newValues: { orderNumber: order.orderNumber, amountHt: parsed.data.amount_ht }, ipAddress: request.ip });
    return reply.code(201).send(orderView(order, customer.name));
  });

  // File des commandes à facturer — visible par la Finance ET le Commercial /
  // la Direction (qui peuvent aussi les initier).
  fastify.get("/api/v1/billing-orders", { preHandler: requireAuth }, async (request, reply) => {
    const perms = request.user!.permissions;
    if (!(perms.has("finance:consultation") || perms.has("commercial:consultation") || perms.has("commercial:saisie") || perms.has("commercial:validation"))) {
      return reply.code(403).send({ code: "forbidden", message: "Accès réservé à la Finance, au commercial ou à la direction." });
    }
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

  // Annulation d'une commande à facturer (client qui se désiste). Ouvert au
  // Commercial, à la Direction et au comptable/Finance — les mêmes profils qui
  // peuvent l'initier ou la traiter. Impossible si elle est déjà FACTURÉE : dans
  // ce cas, c'est un avoir (note de crédit) qu'il faut établir, pas une annulation.
  fastify.post("/api/v1/billing-orders/:id/cancel", { preHandler: requireAuth }, async (request, reply) => {
    const perms = request.user!.permissions;
    if (!(perms.has("commercial:saisie") || perms.has("commercial:validation") || perms.has("finance:saisie"))) {
      return reply.code(403).send({ code: "forbidden", message: "Réservé à la direction, au commercial ou à la Finance." });
    }
    const { id } = request.params as { id: string };
    const parsed = z.object({ reason: z.string().max(500).optional() }).safeParse(request.body ?? {});
    const reason = parsed.success ? parsed.data.reason?.trim() || null : null;

    const order = await prisma.billingOrder.findFirst({ where: { id, deletedAt: null }, include: { customer: { select: { name: true } } } });
    if (!order) return reply.code(404).send({ code: "not_found", message: "Commande introuvable." });
    if (order.status === "invoiced") {
      return reply.code(409).send({ code: "already_invoiced", message: "Cette commande est déjà facturée : établissez un avoir plutôt que de l'annuler." });
    }
    if (order.status === "cancelled") {
      return reply.code(409).send({ code: "already_cancelled", message: "Cette commande est déjà annulée." });
    }

    const note = reason ? `${order.note ? order.note + " · " : ""}Annulée : ${reason}` : order.note;
    const updated = await prisma.billingOrder.update({ where: { id }, data: { status: "cancelled", note } });

    // Retire la commande de la file du pôle Finance : on les prévient (priorité
    // basse) qu'elle a été annulée, pour éviter qu'ils la facturent par erreur.
    const staff = await financeStaffIds();
    if (staff.length) {
      await notifyUsers({ userIds: staff, type: "autre", priority: "low", title: "Commande annulée", body: `${order.label} — ${order.customer.name}${reason ? " · " + reason : ""}`, entityType: "billing_order", entityId: order.id }).catch(() => {});
    }
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "billing_order", entityId: order.id, oldValues: { status: order.status }, newValues: { status: "cancelled", reason }, ipAddress: request.ip });
    return reply.send(orderView(updated, order.customer.name));
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

  // --- Annulation d'une facture, soumise à validation du DG (Ch. 18) ---------
  // Une facture émise est immuable ; son annulation n'est donc pas une
  // suppression mais un changement d'état CONTRÔLÉ : le comptable la DEMANDE
  // (avec motif), le DG la VALIDE. Ce n'est qu'une fois validée qu'elle sort du
  // chiffre d'affaires.

  // Le comptable demande l'annulation d'une facture émise.
  fastify.post("/api/v1/invoices/:id/request-cancellation", { preHandler: requirePermission("finance", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ reason: z.string().min(1).max(500) }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Un motif d'annulation est requis." });
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { customer: { select: { name: true } } } });
    if (!invoice) return reply.code(404).send({ code: "not_found", message: "Facture introuvable." });
    if (invoice.type !== "invoice") return reply.code(409).send({ code: "not_an_invoice", message: "Seule une facture peut être annulée (un avoir ou une proforma, non)." });
    if (invoice.status === "cancelled") return reply.code(409).send({ code: "already_cancelled", message: "Cette facture est déjà annulée." });
    if (invoice.status === "cancellation_requested") return reply.code(409).send({ code: "already_requested", message: "L'annulation de cette facture est déjà en attente de validation du DG." });
    if (invoice.status !== "issued") return reply.code(409).send({ code: "not_cancellable", message: "Seule une facture émise (non réglée) peut être annulée ; sinon, passez par un avoir." });
    // Une facture déjà TIRÉE (imprimée) est un document sorti : on ne l'annule
    // plus dans le système — la correction passe alors par un avoir.
    if (invoice.printedAt) return reply.code(409).send({ code: "already_printed", message: "Cette facture a déjà été imprimée : elle ne peut plus être annulée. Émettez un avoir pour la corriger." });

    await prisma.invoice.update({
      where: { id },
      data: { status: "cancellation_requested", cancellationReason: parsed.data.reason.trim(), cancellationRequestedAt: new Date(), cancellationRequestedBy: request.user!.id },
    });
    const deciders = await financeAdminIds();
    if (deciders.length) {
      await notifyUsers({ userIds: deciders, type: "autre", priority: "high", title: "Annulation de facture à valider", body: `${invoice.invoiceNumber} — ${invoice.customer.name} · Motif : ${parsed.data.reason.trim()}`, entityType: "invoice", entityId: id }).catch(() => {});
    }
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "invoice", entityId: id, oldValues: { status: invoice.status }, newValues: { status: "cancellation_requested", reason: parsed.data.reason.trim() }, ipAddress: request.ip });
    return reply.send({ ok: true, status: "cancellation_requested" });
  });

  // Factures dont l'annulation est en attente de validation du DG.
  fastify.get("/api/v1/invoices/pending-cancellation", { preHandler: requirePermission("finance", "consultation") }, async (_request, reply) => {
    const invoices = await prisma.invoice.findMany({
      where: { status: "cancellation_requested" },
      include: { customer: { select: { name: true } } },
      orderBy: { cancellationRequestedAt: "desc" },
    });
    return reply.send(invoices.map((i) => ({ id: i.id, invoice_number: i.invoiceNumber, customer_name: i.customer.name, total_ttc: Number(i.totalTtc), reason: i.cancellationReason, requested_at: i.cancellationRequestedAt })));
  });

  // Le DG valide l'annulation → la facture passe « annulée » (sort du CA).
  fastify.post("/api/v1/invoices/:id/cancel-approve", { preHandler: requirePermission("finance", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) return reply.code(404).send({ code: "not_found", message: "Facture introuvable." });
    if (invoice.status !== "cancellation_requested") return reply.code(409).send({ code: "not_pending", message: "Aucune annulation en attente pour cette facture." });
    await prisma.invoice.update({ where: { id }, data: { status: "cancelled" } });
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "invoice", entityId: id, oldValues: { status: "cancellation_requested" }, newValues: { status: "cancelled" }, ipAddress: request.ip });
    return reply.send({ ok: true, status: "cancelled" });
  });

  // Le DG refuse l'annulation → la facture reste émise.
  fastify.post("/api/v1/invoices/:id/cancel-reject", { preHandler: requirePermission("finance", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) return reply.code(404).send({ code: "not_found", message: "Facture introuvable." });
    if (invoice.status !== "cancellation_requested") return reply.code(409).send({ code: "not_pending", message: "Aucune annulation en attente pour cette facture." });
    await prisma.invoice.update({ where: { id }, data: { status: "issued", cancellationReason: null, cancellationRequestedAt: null, cancellationRequestedBy: null } });
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "invoice", entityId: id, oldValues: { status: "cancellation_requested" }, newValues: { status: "issued", rejected: true }, ipAddress: request.ip });
    return reply.send({ ok: true, status: "issued" });
  });

  // Avoir (note de crédit) sur une facture : la voie légale quand la facture ne
  // peut plus être annulée (déjà tirée / réglée) — on ne supprime pas, on
  // neutralise. Réservé au comptable/Finance (finance:saisie).
  fastify.post("/api/v1/invoices/:id/credit-note", { preHandler: requirePermission("finance", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ reason: z.string().max(500).optional() }).safeParse(request.body ?? {});
    const reason = parsed.success ? parsed.data.reason?.trim() || undefined : undefined;
    const origin = await prisma.invoice.findUnique({ where: { id } });
    if (!origin) return reply.code(404).send({ code: "not_found", message: "Facture introuvable." });
    if (origin.type !== "invoice") return reply.code(409).send({ code: "not_an_invoice", message: "Un avoir se fait sur une facture (pas sur une proforma ni un avoir)." });
    try {
      const creditNote = await prisma.$transaction((tx) => createCreditNoteFromInvoice(tx, id, reason));
      await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "invoice", entityId: creditNote.id, newValues: { type: "credit_note", invoiceNumber: creditNote.invoiceNumber, parentInvoice: origin.invoiceNumber, reason }, ipAddress: request.ip });
      return reply.code(201).send({ id: creditNote.id, invoice_number: creditNote.invoiceNumber, total_ttc: Number(creditNote.totalTtc) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur";
      if (msg === "already_credited") return reply.code(409).send({ code: "already_credited", message: "Un avoir a déjà été émis pour cette facture." });
      if (msg === "period_closed") return reply.code(409).send({ code: "period_closed", message: "La période comptable est clôturée." });
      throw e;
    }
  });

  // Marque une facture comme « tirée » (imprimée) à sa première impression :
  // elle ne pourra plus être annulée. Idempotent (ne réécrit pas la date).
  fastify.post("/api/v1/invoices/:id/mark-printed", { preHandler: requirePermission("finance", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) return reply.code(404).send({ code: "not_found", message: "Facture introuvable." });
    // Seules les vraies factures portent le verrou ; proforma / avoir : sans effet.
    if (invoice.type === "invoice" && !invoice.printedAt) {
      await prisma.invoice.update({ where: { id }, data: { printedAt: new Date() } });
    }
    return reply.send({ ok: true, printed_at: (invoice.printedAt ?? new Date()).toISOString() });
  });
}
