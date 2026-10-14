import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { notifyUsers } from "../lib/notify.js";
import { nextBillingOrderNumber } from "../lib/billingOrderNumber.js";
import { createInvoiceFromBillingOrder, createCreditNoteFromInvoice, recordAdvancePayment } from "../lib/invoicing.js";
import { recordSchoolRoyaltyEntries } from "../lib/schoolRoyalty.js";

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

// Décideurs de GOUVERNANCE, seuls habilités à VALIDER l'annulation d'une facture
// OU une facture au-dessus du seuil :
// le Directeur général et l'administrateur général — PAS la Finance (séparation
// des pouvoirs : la Finance DEMANDE l'annulation, la Direction la valide). Le
// discriminant est la permission « pilotage:administration », détenue par le DG
// et l'admin général, mais pas par le responsable financier.
async function governanceDeciderIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: {
      status: "active",
      deletedAt: null,
      accountType: "internal",
      userRoles: { some: { revokedAt: null, role: { rolePermissions: { some: { permission: { module: "pilotage", action: "administration" } } } } } },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

type OrderLineRow = { id: string; description: string; quantity: number; unitPriceHt: unknown; isbnId?: string | null };
function orderView(
  o: { id: string; orderNumber: string; category: string; label: string; amountHt: unknown; taxRate: unknown; discountPct?: unknown; status: string; createdAt: Date; lines?: OrderLineRow[] },
  customerName: string,
) {
  const ht = Number(o.amountHt);
  const rate = Number(o.taxRate);
  const discount = Number(o.discountPct ?? 0);
  return {
    id: o.id,
    reference: o.orderNumber,
    category: o.category,
    label: o.label,
    customer_name: customerName,
    amount_ht: ht,
    tax_rate: rate,
    amount_ttc: Math.round(ht * (1 + rate / 100) * 100) / 100,
    discount_pct: discount,
    status: o.status,
    created_at: o.createdAt,
    // Détail des lignes saisies (ouvrages / éléments « Autre »), pour que la
    // proforma — comme la facture définitive — affiche TOUS les libellés et
    // leurs montants, et non un seul libellé global.
    lines: (o.lines ?? []).map((l) => {
      const unit = Number(l.unitPriceHt);
      return {
        id: l.id,
        description: l.description,
        quantity: l.quantity,
        unit_price_ht: unit,
        line_total: Math.round(l.quantity * unit * 100) / 100,
        isbn_id: l.isbnId ?? null,
      };
    }),
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
        category: z.enum(["livre_scolaire", "livre_general", "autre"]).default("livre_scolaire"),
        label: z.string().min(1).max(200),
        // Montant global (mode simple) OU détail par ouvrage (mode livre scolaire,
        // qui déclenche le calcul des droits d'auteur). Au moins l'un des deux.
        amount_ht: z.number().positive().optional(),
        tax_rate: z.number().min(0).max(100).default(0),
        // Remise commerciale prévue (0–100 %), reprise à l'établissement.
        discount_pct: z.number().min(0).max(100).default(0),
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
        discountPct: parsed.data.discount_pct,
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
      include: { lines: true },
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
      include: { customer: { select: { name: true } }, lines: true },
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
    const parsed = z
      .object({
        discount_pct: z.number().min(0).max(100).optional(),
        // Avance (acompte) versée à l'établissement : montant, libellé imprimé
        // (défaut « Avance ») et mode de paiement (code de la liste configurable).
        advance_amount: z.number().min(0).optional(),
        advance_label: z.string().max(120).optional(),
        advance_method: z.string().max(60).optional(),
      })
      .safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Remise ou avance invalide." });
    const order = await prisma.billingOrder.findFirst({ where: { id, deletedAt: null } });
    if (!order) return reply.code(404).send({ code: "not_found", message: "Commande introuvable." });
    if (order.status !== "pending") return reply.code(409).send({ code: "not_pending", message: "Cette commande est déjà facturée ou annulée." });
    // Remise fournie à l'établissement, sinon celle prévue sur la commande.
    const discountPct = parsed.data.discount_pct ?? Number(order.discountPct);

    // Avance : si un montant > 0 est saisi, le mode de paiement doit être valide
    // (on enregistre un encaissement réel). Le libellé par défaut est « Avance ».
    const advanceAmount = parsed.data.advance_amount ?? 0;
    let advance: { amount: number; label?: string | null; method: string } | undefined;
    if (advanceAmount > 0) {
      const method = parsed.data.advance_method?.trim() || "cash";
      const methodDef = await prisma.paymentMethodDef.findUnique({ where: { code: method } });
      if (!methodDef || !methodDef.active) return reply.code(400).send({ code: "invalid_payment_method", message: "Mode de paiement de l'avance inconnu ou désactivé." });
      advance = { amount: advanceAmount, label: parsed.data.advance_label?.trim() || "Avance", method };
    }

    const threshold = await getThreshold();
    try {
      const invoice = await prisma.$transaction((tx) => createInvoiceFromBillingOrder(tx, id, threshold, discountPct, advance));
      await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "invoice", entityId: invoice.id, newValues: { invoiceNumber: invoice.invoiceNumber, fromBillingOrder: order.orderNumber, status: invoice.status }, ipAddress: request.ip });
      // Facture au-dessus du seuil → décision de GOUVERNANCE : c'est le DG (ou
      // l'administrateur général) qui valide, pas la Finance. On avertit les
      // décideurs de gouvernance par une cloche, sans se notifier soi-même.
      if (invoice.status === "pending_validation") {
        const deciders = (await governanceDeciderIds()).filter((uid) => uid !== request.user!.id);
        if (deciders.length) {
          await notifyUsers({ userIds: deciders, type: "autre", priority: "high", title: "Facture à valider (au-dessus du seuil)", body: `${invoice.invoiceNumber} — ${order.label} · ${Number(invoice.totalTtc).toLocaleString("fr-FR")} XAF`, entityType: "invoice", entityId: invoice.id }).catch(() => {});
        }
      }
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

  // Validation d'une facture au-dessus du seuil → émise. Décision de GOUVERNANCE
  // (pilotage:administration) : le DG / l'administrateur général valide, pas la
  // Finance qui a établi la facture (séparation des pouvoirs).
  fastify.post("/api/v1/invoices/:id/validate", { preHandler: requirePermission("pilotage", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) return reply.code(404).send({ code: "not_found", message: "Facture introuvable." });
    if (invoice.status !== "pending_validation") return reply.code(409).send({ code: "not_pending", message: "Cette facture n'est pas en attente de validation." });
    // La facture est émise ; si une AVANCE avait été saisie à l'établissement
    // (encaissement différé car au-dessus du seuil), on l'enregistre maintenant.
    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id }, data: { status: "issued" } });
      if (Number(invoice.advanceAmount) > 0) {
        await recordAdvancePayment(tx, id, Number(invoice.advanceAmount), invoice.advanceMethod || "cash");
      }
    });
    await writeAuditLog({ userId: request.user!.id, action: "validate", entityType: "invoice", entityId: id, oldValues: { status: "pending_validation" }, newValues: { status: "issued", advance: Number(invoice.advanceAmount) || undefined }, ipAddress: request.ip });
    return reply.send({ ok: true, status: "issued" });
  });

  // Refus d'une facture en attente de validation (DG) : elle n'est jamais émise.
  // Son numéro légal étant déjà attribué, on ne la supprime pas — on la passe
  // « annulée » (hors CA) avec un motif obligatoire. Les droits d'auteur du livre
  // scolaire éventuellement calculés à sa création sont contre-passés, et la
  // commande à facturer d'origine repasse « à facturer » (à revoir ou annuler).
  fastify.post("/api/v1/invoices/:id/validate-reject", { preHandler: requirePermission("pilotage", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ reason: z.string().min(1).max(500) }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Un motif de refus est requis." });
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { schoolRoyaltyEntries: true } });
    if (!invoice) return reply.code(404).send({ code: "not_found", message: "Facture introuvable." });
    if (invoice.status !== "pending_validation") return reply.code(409).send({ code: "not_pending", message: "Cette facture n'est pas en attente de validation." });

    await prisma.$transaction(async (tx) => {
      // Contre-passe les droits scolaires enregistrés à la création de la facture.
      if (invoice.schoolRoyaltyEntries.length) {
        await recordSchoolRoyaltyEntries(tx, {
          invoiceId: invoice.id,
          sourceType: "credit_note",
          lines: invoice.schoolRoyaltyEntries.map((e) => ({ invoiceLineId: null, isbnId: e.isbnId, description: e.bookTitle, quantity: -e.quantity, unitPriceHt: Number(e.unitPriceHt), rate: Number(e.rateApplied) })),
        });
      }
      await tx.invoice.update({ where: { id }, data: { status: "cancelled", cancellationReason: parsed.data.reason.trim() } });
      // La commande à facturer d'origine redevient « à facturer ».
      const bo = await tx.billingOrder.findFirst({ where: { invoiceId: id } });
      if (bo) await tx.billingOrder.update({ where: { id: bo.id }, data: { status: "pending", invoiceId: null } });
    });

    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "invoice", entityId: id, oldValues: { status: "pending_validation" }, newValues: { status: "cancelled", rejected: true, reason: parsed.data.reason.trim() }, ipAddress: request.ip });
    // Prévenir le pôle Finance que la facture a été refusée (commande à revoir).
    const staff = (await financeStaffIds()).filter((uid) => uid !== request.user!.id);
    if (staff.length) {
      await notifyUsers({ userIds: staff, type: "autre", priority: "medium", title: "Facture refusée par le DG", body: `${invoice.invoiceNumber} — ${parsed.data.reason.trim()} · la commande repasse « à facturer ».`, entityType: "invoice", entityId: id }).catch(() => {});
    }
    return reply.send({ ok: true, status: "cancelled" });
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
    // Séparation des pouvoirs : la Finance DEMANDE, la Direction VALIDE. On notifie
    // donc les décideurs de gouvernance (DG / administrateur général), pas la
    // Finance, et jamais soi-même.
    const deciders = (await governanceDeciderIds()).filter((uid) => uid !== request.user!.id);
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

  // Le DG (ou l'administrateur général) valide l'annulation → « annulée » (sort du
  // CA). Réservé à la GOUVERNANCE (pilotage:administration) : la Finance, qui a
  // demandé l'annulation, ne peut pas la valider elle-même (séparation des pouvoirs).
  fastify.post("/api/v1/invoices/:id/cancel-approve", { preHandler: requirePermission("pilotage", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) return reply.code(404).send({ code: "not_found", message: "Facture introuvable." });
    if (invoice.status !== "cancellation_requested") return reply.code(409).send({ code: "not_pending", message: "Aucune annulation en attente pour cette facture." });
    await prisma.invoice.update({ where: { id }, data: { status: "cancelled" } });
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "invoice", entityId: id, oldValues: { status: "cancellation_requested" }, newValues: { status: "cancelled" }, ipAddress: request.ip });
    return reply.send({ ok: true, status: "cancelled" });
  });

  // Le DG (ou l'administrateur général) refuse l'annulation → la facture reste
  // émise. Même réserve de gouvernance que la validation (pas la Finance).
  fastify.post("/api/v1/invoices/:id/cancel-reject", { preHandler: requirePermission("pilotage", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) return reply.code(404).send({ code: "not_found", message: "Facture introuvable." });
    if (invoice.status !== "cancellation_requested") return reply.code(409).send({ code: "not_pending", message: "Aucune annulation en attente pour cette facture." });
    await prisma.invoice.update({ where: { id }, data: { status: "issued", cancellationReason: null, cancellationRequestedAt: null, cancellationRequestedBy: null } });
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "invoice", entityId: id, oldValues: { status: "cancellation_requested" }, newValues: { status: "issued", rejected: true }, ipAddress: request.ip });
    return reply.send({ ok: true, status: "issued" });
  });

  // Annulation DIRECTE par la GOUVERNANCE (DG / administrateur général), possible
  // MÊME sur une facture déjà imprimée (« tirée ») — réservée aux erreurs de
  // saisie / essais. Ce n'est PAS une suppression : la facture passe « Annulée »
  // (statut conservé, motif obligatoire, journal d'audit), et sort du chiffre
  // d'affaires. Réservé à pilotage:administration ; la Finance ne l'a pas. Ne
  // s'applique pas à une facture déjà réglée (là, la correction passe par un avoir).
  fastify.post("/api/v1/invoices/:id/force-cancel", { preHandler: requirePermission("pilotage", "administration") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ reason: z.string().min(1).max(500) }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Un motif d'annulation est requis." });
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) return reply.code(404).send({ code: "not_found", message: "Facture introuvable." });
    if (invoice.type !== "invoice") return reply.code(409).send({ code: "not_an_invoice", message: "Seule une facture peut être annulée (un avoir ou une proforma, non)." });
    if (invoice.status === "cancelled") return reply.code(409).send({ code: "already_cancelled", message: "Cette facture est déjà annulée." });
    if (invoice.status === "paid") return reply.code(409).send({ code: "already_paid", message: "Cette facture est réglée : corrigez-la par un avoir, pas par une annulation." });

    await prisma.$transaction(async (tx) => {
      // Facture d'essai : on retire aussi ses droits d'auteur « livre » calculés à
      // l'émission, pour qu'ils ne pèsent plus sur les exemplaires / droits.
      await tx.schoolRoyaltyEntry.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.update({
        where: { id },
        data: { status: "cancelled", cancellationReason: parsed.data.reason.trim(), cancellationRequestedAt: new Date(), cancellationRequestedBy: request.user!.id },
      });
    });
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "invoice", entityId: id, oldValues: { status: invoice.status, printed: !!invoice.printedAt }, newValues: { status: "cancelled", forced: true, reason: parsed.data.reason.trim() }, ipAddress: request.ip });
    return reply.send({ ok: true, status: "cancelled" });
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

  // Correction AVANT la première impression (demande opérateur 23/08/2026) : tant
  // qu'une facture n'a pas été tirée, elle n'a « pas fait foi » — la Finance peut
  // donc l'annuler DIRECTEMENT (sans validation DG, sans avoir) pour la réémettre
  // depuis la source corrigée. Strictement borné : facture émise, NON imprimée.
  // Après le premier tirage, on repasse par la demande d'annulation (DG) ou l'avoir.
  fastify.post("/api/v1/invoices/:id/cancel-before-print", { preHandler: requirePermission("finance", "saisie") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ reason: z.string().min(1).max(500) }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Un motif de correction est requis." });
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) return reply.code(404).send({ code: "not_found", message: "Facture introuvable." });
    if (invoice.type !== "invoice") return reply.code(409).send({ code: "not_an_invoice", message: "Seule une facture peut être annulée (un avoir ou une proforma, non)." });
    if (invoice.status === "cancelled") return reply.code(409).send({ code: "already_cancelled", message: "Cette facture est déjà annulée." });
    if (invoice.status !== "issued" && invoice.status !== "cancellation_requested") {
      return reply.code(409).send({ code: "not_cancellable", message: "Seule une facture émise (non réglée) peut être annulée avant impression." });
    }
    if (invoice.printedAt) {
      return reply.code(409).send({ code: "already_printed", message: "Cette facture a déjà été imprimée : elle fait foi. Passez par la demande d'annulation (DG) ou émettez un avoir." });
    }

    await prisma.$transaction(async (tx) => {
      await tx.schoolRoyaltyEntry.deleteMany({ where: { invoiceId: id } });
      // Facture issue d'un devis éditorial (compte d'auteur) : on rouvre le devis
      // pour permettre de le corriger puis de réémettre la facture.
      if (invoice.sourceType.endsWith("_quote")) {
        await tx.editorialQuote.updateMany({ where: { id: invoice.sourceId, invoiceId: id }, data: { status: "accepted", invoiceId: null } });
      }
      await tx.invoice.update({
        where: { id },
        data: { status: "cancelled", cancellationReason: parsed.data.reason.trim(), cancellationRequestedAt: new Date(), cancellationRequestedBy: request.user!.id },
      });
    });
    await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "invoice", entityId: id, oldValues: { status: invoice.status, printed: false }, newValues: { status: "cancelled", beforePrint: true, reason: parsed.data.reason.trim() }, ipAddress: request.ip });
    return reply.send({ ok: true, status: "cancelled" });
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
