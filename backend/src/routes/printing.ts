import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PrintQuoteStatus, PurchaseOrderStatus, ProductionMilestoneType, QcVerdict, BatStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission, requireAnyPermission } from "../lib/permissions.js";

// L'ÉTABLISSEMENT du bon de commande (et ses consignes / sa consultation) est
// ouvert à trois fonctions : responsable Impression, responsable Stock & magasin,
// DAF. Les devis/imprimeurs restent pilotés par le responsable Impression.
const BON_SAISIE = [
  { module: "printing", action: "saisie" as const },
  { module: "stock", action: "saisie" as const },
  { module: "finance", action: "saisie" as const },
  // La Direction générale (printing:administration) peut aussi établir le bon de
  // commande, au titre de la fonction « direction » (choix opérateur 09/11/2026).
  { module: "printing", action: "administration" as const },
];
const BON_CONSULT = [
  { module: "printing", action: "consultation" as const },
  { module: "stock", action: "consultation" as const },
  { module: "finance", action: "consultation" as const },
];
import { writeAuditLog } from "../lib/audit.js";
import { notifyRole } from "../lib/notify.js";
import { nextPoNumber } from "../lib/poNumber.js";
import { QC_CHECKLIST_ITEMS, QC_CHECKLIST_CODES } from "../lib/qcChecklist.js";

async function purchaseOrderDelegationThreshold(): Promise<number> {
  const setting = await prisma.setting.findUnique({ where: { key: "purchase_order_delegation_threshold" } });
  return (setting?.value as number | undefined) ?? 5_000_000;
}

const printerSchema = z.object({
  partner_id: z.string().uuid(),
  specialties: z.array(z.string()).default([]),
  payment_terms: z.string().optional(),
});

// Création RAPIDE d'un imprimeur depuis la fiche (carnet d'imprimeurs) : crée en
// une fois le partenaire (catégorie « imprimeur ») ET le Printer associé, pour que
// l'étape Impression soit utilisable sans passer par un écran séparé.
const quickPrinterSchema = z.object({
  name: z.string().trim().min(2).max(160),
  city: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(60).optional(),
  email: z.string().trim().max(160).optional(),
  // Mentions légales à reporter sur le bon de commande (facultatives).
  niu: z.string().trim().max(120).optional(),
  rccm: z.string().trim().max(160).optional(),
  bank_account: z.string().trim().max(200).optional(),
  specialties: z.array(z.string()).default([]),
  payment_terms: z.string().trim().max(400).optional(),
});

const printQuoteRequestSchema = z.object({
  printer_id: z.string().uuid(),
  quantities: z.array(z.number().int().positive()).min(1),
});

const printQuoteReceivedSchema = z.object({
  amounts: z.record(z.number().positive()),
  lead_time_days: z.number().int().positive().optional(),
  valid_until: z.string().datetime().optional(),
});

const selectQuoteSchema = z.object({
  selection_motive: z.string().min(1),
  chosen_quantity: z.number().int().positive(),
});

const purchaseOrderSchema = z.object({
  delivery_due: z.string().datetime().optional(),
  delivery_location_id: z.string().uuid().optional(),
  quantity_tolerance_pct: z.number().nonnegative().optional(),
  printer_instructions: z.string().max(2000).optional(),
  established_by_function: z.enum(["impression", "stock", "daf", "direction"]).optional(),
});

const poStatusSchema = z.object({ status: z.nativeEnum(PurchaseOrderStatus) });

const milestoneSchema = z.object({
  planned_at: z.string().datetime().optional(),
  actual_at: z.string().datetime().optional(),
});

const goodsReceiptSchema = z.object({ quantity_received: z.number().int().nonnegative() });
const qcChecklistSchema = z
  .array(
    z.object({
      code: z.enum(QC_CHECKLIST_CODES as [string, ...string[]]),
      ok: z.boolean(),
      note: z.string().max(500).optional(),
    }),
  )
  .optional();
const qcVerdictSchema = z.object({
  verdict: z.nativeEnum(QcVerdict),
  checklist: qcChecklistSchema,
  comment: z.string().max(2000).optional(),
});
const claimSchema = z.object({ description: z.string().min(1) });
const claimResolveSchema = z.object({ resolution: z.string().min(1) });

const reprintSchema = z.object({
  printer_id: z.string().uuid(),
  quantity: z.number().int().positive(),
  amount: z.number().positive(),
  delivery_due: z.string().datetime().optional(),
  delivery_location_id: z.string().uuid().optional(),
});

// Ch. 15 : relation avec les imprimeurs et suivi de la fabrication, du devis
// jusqu'à la réception — reçoit le dossier verrouillé transmis après
// signature du BAT (Ch. 14 §14.6), livre les exemplaires contrôlés au stock (Ch. 16).
export default async function printingRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/printers", { preHandler: requirePermission("printing", "consultation") }, async (request, reply) => {
    const printers = await prisma.printer.findMany({ include: { partner: true } });
    return reply.send(printers);
  });

  fastify.post("/api/v1/printers", { preHandler: requirePermission("printing", "administration") }, async (request, reply) => {
    const parsed = printerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const partner = await prisma.partner.findFirst({ where: { id: parsed.data.partner_id, deletedAt: null } });
    if (!partner || partner.category !== "imprimeur") {
      return reply.code(409).send({ code: "invalid_partner_category", message: "Le partenaire doit être de catégorie « imprimeur »." });
    }
    const printer = await prisma.printer.create({
      data: { partnerId: parsed.data.partner_id, specialties: parsed.data.specialties, paymentTerms: parsed.data.payment_terms },
    });
    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "printer",
      entityId: printer.id,
      newValues: parsed.data,
      ipAddress: request.ip,
    });
    return reply.code(201).send(printer);
  });

  // Carnet d'imprimeurs — ajout rapide (partenaire « imprimeur » + Printer) en un
  // seul appel, directement depuis la rubrique Impression de la fiche de l'ouvrage.
  fastify.post("/api/v1/printers/quick", { preHandler: requirePermission("printing", "administration") }, async (request, reply) => {
    const parsed = quickPrinterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const d = parsed.data;
    const printer = await prisma.$transaction(async (tx) => {
      const partner = await tx.partner.create({
        data: {
          category: "imprimeur",
          firstName: d.name,   // raison sociale de l'imprimeur
          lastName: "",
          city: d.city ?? null,
          phone: d.phone ?? null,
          email: d.email ?? null,
          niu: d.niu ?? null,
          rccm: d.rccm ?? null,
          bankAccount: d.bank_account ?? null,
        },
      });
      return tx.printer.create({
        data: { partnerId: partner.id, specialties: d.specialties, paymentTerms: d.payment_terms },
        include: { partner: true },
      });
    });
    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "printer",
      entityId: printer.id,
      newValues: { name: d.name, city: d.city },
      ipAddress: request.ip,
    });
    return reply.code(201).send(printer);
  });

  // Évaluation continue du fournisseur (Ch. 15 §15.2), calculée à la demande
  // à partir des données déjà enregistrées (délais, non-conformité, réclamations).
  fastify.get("/api/v1/printers/:id", { preHandler: requirePermission("printing", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const printer = await prisma.printer.findUnique({
      where: { id },
      include: {
        partner: true,
        purchaseOrders: {
          include: { milestones: true, goodsReceipts: { include: { claims: true } } },
        },
        quotes: true,
      },
    });
    if (!printer) {
      return reply.code(404).send({ code: "not_found", message: "Imprimeur introuvable." });
    }

    const deliveredMilestones = printer.purchaseOrders
      .flatMap((po) => po.milestones)
      .filter((m) => m.milestone === "delivered" && m.plannedAt && m.actualAt);
    const onTimeCount = deliveredMilestones.filter((m) => m.actualAt! <= m.plannedAt!).length;

    const receipts = printer.purchaseOrders.flatMap((po) => po.goodsReceipts);
    const nonConformCount = receipts.filter((r) => r.qcVerdict && r.qcVerdict !== "conform").length;

    const openClaims = printer.purchaseOrders
      .flatMap((po) => po.goodsReceipts)
      .flatMap((r) => r.claims)
      .filter((c) => !c.resolvedAt);

    const selectedQuotes = printer.quotes.filter((q) => q.status === "selected" && q.selectedQuantity && q.amounts);
    const averageAmount =
      selectedQuotes.length > 0
        ? selectedQuotes.reduce((sum, q) => sum + Number((q.amounts as Record<string, number>)[String(q.selectedQuantity)] ?? 0), 0) /
          selectedQuotes.length
        : null;

    return reply.send({
      printer,
      stats: {
        orders_count: printer.purchaseOrders.length,
        on_time_rate: deliveredMilestones.length > 0 ? onTimeCount / deliveredMilestones.length : null,
        non_conformity_rate: receipts.length > 0 ? nonConformCount / receipts.length : null,
        open_claims_count: openClaims.length,
        average_selected_quote_amount: averageAmount,
      },
    });
  });

  // Demande de devis (Ch. 15 §15.3) : réservée aux ouvrages dont le BAT est signé.
  fastify.post(
    "/api/v1/manuscripts/:id/print-quotes",
    { preHandler: requirePermission("printing", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = printQuoteRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const manuscript = await prisma.manuscript.findFirst({ where: { id, deletedAt: null } });
      if (!manuscript) {
        return reply.code(404).send({ code: "not_found", message: "Manuscrit introuvable." });
      }
      const signedBat = await prisma.batRecord.findFirst({ where: { manuscriptId: id, status: BatStatus.signed } });
      if (!signedBat) {
        return reply.code(409).send({ code: "bat_not_signed", message: "Le BAT doit être signé avant toute consultation imprimeur (Ch. 15 §15.1)." });
      }

      const quote = await prisma.printQuote.create({
        data: {
          manuscriptId: id,
          printerId: parsed.data.printer_id,
          quantities: parsed.data.quantities,
          status: PrintQuoteStatus.requested,
        },
      });
      return reply.code(201).send(quote);
    },
  );

  fastify.get(
    "/api/v1/manuscripts/:id/print-quotes",
    { preHandler: requirePermission("printing", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const quotes = await prisma.printQuote.findMany({
        where: { manuscriptId: id, deletedAt: null },
        include: { printer: { include: { partner: true } } },
        orderBy: { createdAt: "asc" },
      });
      // Tableau comparatif automatique (Ch. 15 §15.3 point 4) : coût unitaire par hypothèse de tirage.
      const comparison = quotes.map((quote) => {
        const amounts = (quote.amounts as Record<string, number> | null) ?? {};
        return {
          quote_id: quote.id,
          printer_id: quote.printerId,
          unit_costs: Object.fromEntries(Object.entries(amounts).map(([qty, total]) => [qty, total / Number(qty)])),
          lead_time_days: quote.leadTimeDays,
          status: quote.status,
        };
      });
      return reply.send({ quotes, comparison });
    },
  );

  fastify.patch(
    "/api/v1/print-quotes/:id",
    { preHandler: requirePermission("printing", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = printQuoteReceivedSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const updated = await prisma.printQuote.update({
        where: { id },
        data: {
          amounts: JSON.parse(JSON.stringify(parsed.data.amounts)),
          leadTimeDays: parsed.data.lead_time_days,
          validUntil: parsed.data.valid_until ? new Date(parsed.data.valid_until) : undefined,
          status: PrintQuoteStatus.received,
        },
      });
      return reply.send(updated);
    },
  );

  // Suppression LOGIQUE d'un devis (doublon, erreur de saisie) : autorisée à qui
  // peut établir un bon de commande (Impression / Stock / DAF / Direction), tant
  // que le devis n'a PAS donné lieu à un bon de commande (sinon le bon devrait
  // être annulé d'abord). Un devis « sélectionné » reste supprimable tant qu'il
  // n'a pas de bon de commande (on peut revenir sur le choix).
  fastify.delete(
    "/api/v1/print-quotes/:id",
    { preHandler: requireAnyPermission(BON_SAISIE) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const quote = await prisma.printQuote.findFirst({ where: { id, deletedAt: null }, include: { purchaseOrder: { select: { id: true } } } });
      if (!quote) return reply.code(404).send({ code: "not_found", message: "Devis introuvable." });
      if (quote.purchaseOrder) {
        return reply.code(409).send({ code: "quote_has_purchase_order", message: "Ce devis a déjà donné lieu à un bon de commande : annulez d'abord le bon de commande." });
      }
      await prisma.printQuote.update({ where: { id }, data: { deletedAt: new Date() } });
      await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "print_quote", entityId: id, newValues: { deleted: true }, ipAddress: request.ip });
      return reply.send({ ok: true });
    },
  );

  // Choix motivé (Ch. 15 §15.3 point 5) : au-delà du seuil de délégation
  // paramétrable, seule la Direction générale (printing:administration) peut valider.
  fastify.post(
    "/api/v1/print-quotes/:id/select",
    { preHandler: requirePermission("printing", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = selectQuoteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const quote = await prisma.printQuote.findUnique({ where: { id } });
      if (!quote) {
        return reply.code(404).send({ code: "not_found", message: "Devis introuvable." });
      }
      const amounts = (quote.amounts as Record<string, number> | null) ?? {};
      const amount = amounts[String(parsed.data.chosen_quantity)];
      if (amount === undefined) {
        return reply.code(400).send({ code: "validation_error", message: "Aucun montant reçu pour cette hypothèse de tirage." });
      }

      const threshold = await purchaseOrderDelegationThreshold();
      if (amount > threshold && !request.user!.permissions.has("printing:administration")) {
        return reply.code(403).send({
          code: "delegation_threshold_exceeded",
          message: `Montant au-delà du seuil de délégation (${threshold}) : validation de la Direction générale requise.`,
        });
      }

      const [selected] = await prisma.$transaction([
        prisma.printQuote.update({
          where: { id },
          data: { status: PrintQuoteStatus.selected, selectionMotive: parsed.data.selection_motive, selectedQuantity: parsed.data.chosen_quantity },
        }),
        prisma.printQuote.updateMany({
          where: { manuscriptId: quote.manuscriptId, id: { not: id }, status: { in: ["requested", "received"] } },
          data: { status: PrintQuoteStatus.declined },
        }),
      ]);

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "print_quote",
        entityId: id,
        newValues: { status: "selected", chosenQuantity: parsed.data.chosen_quantity, amount },
        ipAddress: request.ip,
      });

      return reply.send(selected);
    },
  );

  // Bon de commande (Ch. 15 §15.4) : reprend la fiche technique et le prix
  // convenu, référence l'empreinte des fichiers verrouillés du BAT signé.
  fastify.post(
    "/api/v1/print-quotes/:id/purchase-order",
    { preHandler: requireAnyPermission(BON_SAISIE) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = purchaseOrderSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const quote = await prisma.printQuote.findUnique({ where: { id } });
      if (!quote) {
        return reply.code(404).send({ code: "not_found", message: "Devis introuvable." });
      }
      if (quote.status !== PrintQuoteStatus.selected || !quote.selectedQuantity) {
        return reply.code(409).send({ code: "quote_not_selected", message: "Le devis doit être sélectionné avant de générer un bon de commande." });
      }
      const amounts = (quote.amounts as Record<string, number> | null) ?? {};
      const amount = amounts[String(quote.selectedQuantity)];

      const signedBat = await prisma.batRecord.findFirst({
        where: { manuscriptId: quote.manuscriptId, status: BatStatus.signed },
        include: { signatures: { orderBy: { signedAt: "desc" }, take: 1 } },
      });
      const filesHashReference = signedBat?.signatures[0]?.filesHash;

      const poNumber = await nextPoNumber();
      const po = await prisma.purchaseOrder.create({
        data: {
          quoteId: id,
          printerId: quote.printerId,
          poNumber,
          orderedQuantity: quote.selectedQuantity,
          amount,
          deliveryDue: parsed.data.delivery_due ? new Date(parsed.data.delivery_due) : undefined,
          deliveryLocationId: parsed.data.delivery_location_id,
          quantityTolerancePct: parsed.data.quantity_tolerance_pct,
          printerInstructions: parsed.data.printer_instructions ?? undefined,
          establishedByName: request.user!.username,
          establishedByFunction: parsed.data.established_by_function ?? undefined,
          filesHashReference,
          createdBy: request.user!.id,
        },
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "purchase_order",
        entityId: po.id,
        newValues: { poNumber, amount, orderedQuantity: quote.selectedQuantity },
        ipAddress: request.ip,
      });

      return reply.code(201).send(po);
    },
  );

  fastify.get(
    "/api/v1/manuscripts/:id/purchase-orders",
    { preHandler: requireAnyPermission(BON_CONSULT) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orders = await prisma.purchaseOrder.findMany({
        where: { quote: { manuscriptId: id } },
        include: {
          milestones: true,
          goodsReceipts: { include: { claims: { orderBy: { createdAt: "desc" } } }, orderBy: { receivedAt: "desc" } },
          printer: { include: { partner: true } },
          // Fiche technique (Maquette) + RÉFÉRENCES de l'ouvrage (ISBN, auteur)
          // reprises sur le bon de commande — récupérées automatiquement.
          quote: { include: { manuscript: { select: {
            title: true, manuscriptNumber: true, productionSpecs: true,
            isbns: { select: { isbn13: true }, orderBy: { createdAt: "desc" } },
            workContributors: { where: { role: "author" }, orderBy: { displayOrder: "asc" }, include: { partner: { select: { firstName: true, lastName: true, penName: true } } } },
          } } } },
          deliveryLocation: { select: { label: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return reply.send(orders);
    },
  );

  // Consignes libres à l'imprimeur sur un bon de commande (texte repris à l'impression).
  fastify.patch(
    "/api/v1/purchase-orders/:id/instructions",
    { preHandler: requireAnyPermission(BON_SAISIE) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ printer_instructions: z.string().max(2000) }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const po = await prisma.purchaseOrder.findUnique({ where: { id }, select: { id: true } });
      if (!po) return reply.code(404).send({ code: "not_found", message: "Bon de commande introuvable." });
      const updated = await prisma.purchaseOrder.update({
        where: { id },
        data: { printerInstructions: parsed.data.printer_instructions.trim() || null },
      });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "purchase_order", entityId: id, newValues: { instructions_updated: true }, ipAddress: request.ip });
      return reply.send(updated);
    },
  );

  // Modification du bon de commande AVANT approbation (aperçu + modifier) : date
  // de livraison, lieu, tolérance de quantité et consignes. Réservé au brouillon
  // (une fois approuvé/transmis, le document est figé). Ouvert aux fonctions qui
  // établissent le bon (Impression / Stock / DAF / Direction).
  fastify.patch(
    "/api/v1/purchase-orders/:id",
    { preHandler: requireAnyPermission(BON_SAISIE) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const schema = z.object({
        delivery_due: z.string().datetime().nullish(),
        delivery_location_id: z.string().uuid().nullish(),
        quantity_tolerance_pct: z.number().nonnegative().nullish(),
        printer_instructions: z.string().max(2000).nullish(),
      });
      const parsed = schema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const po = await prisma.purchaseOrder.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!po) return reply.code(404).send({ code: "not_found", message: "Bon de commande introuvable." });
      if (po.status !== PurchaseOrderStatus.draft) {
        return reply.code(409).send({ code: "po_not_draft", message: "Un bon de commande ne se modifie qu'au brouillon, avant son approbation." });
      }
      const d = parsed.data;
      const updated = await prisma.purchaseOrder.update({
        where: { id },
        data: {
          deliveryDue: d.delivery_due !== undefined ? (d.delivery_due ? new Date(d.delivery_due) : null) : undefined,
          deliveryLocationId: d.delivery_location_id !== undefined ? d.delivery_location_id : undefined,
          quantityTolerancePct: d.quantity_tolerance_pct !== undefined ? d.quantity_tolerance_pct : undefined,
          printerInstructions: d.printer_instructions !== undefined ? (d.printer_instructions?.trim() || null) : undefined,
        },
      });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "purchase_order", entityId: id, newValues: { edited: true }, ipAddress: request.ip });
      return reply.send(updated);
    },
  );

  // Circuit de délégation (Ch. 15 §15.4) : même seuil que la sélection du devis.
  fastify.patch(
    "/api/v1/purchase-orders/:id/status",
    { preHandler: requirePermission("printing", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = poStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const po = await prisma.purchaseOrder.findUnique({ where: { id } });
      if (!po) {
        return reply.code(404).send({ code: "not_found", message: "Bon de commande introuvable." });
      }

      if (parsed.data.status === PurchaseOrderStatus.approved) {
        const threshold = await purchaseOrderDelegationThreshold();
        if (Number(po.amount) > threshold && !request.user!.permissions.has("printing:administration")) {
          return reply.code(403).send({
            code: "delegation_threshold_exceeded",
            message: `Montant au-delà du seuil de délégation (${threshold}) : validation de la Direction générale requise.`,
          });
        }
      }

      const updated = await prisma.purchaseOrder.update({
        where: { id },
        data: { status: parsed.data.status, approvedBy: parsed.data.status === PurchaseOrderStatus.approved ? request.user!.id : undefined },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "purchase_order",
        entityId: id,
        newValues: { status: parsed.data.status },
        ipAddress: request.ip,
      });
      return reply.send(updated);
    },
  );

  // Jalons de fabrication (Ch. 15 §15.6) : un retard (réel après prévu) alerte
  // le responsable impression.
  fastify.patch(
    "/api/v1/purchase-orders/:id/milestones/:milestone",
    { preHandler: requirePermission("printing", "saisie") },
    async (request, reply) => {
      const { id, milestone } = request.params as { id: string; milestone: string };
      const parsed = milestoneSchema.safeParse(request.body);
      if (!parsed.success || !(Object.values(ProductionMilestoneType) as string[]).includes(milestone)) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.success ? undefined : parsed.error.issues });
      }
      const po = await prisma.purchaseOrder.findUnique({ where: { id } });
      if (!po) {
        return reply.code(404).send({ code: "not_found", message: "Bon de commande introuvable." });
      }

      const plannedAt = parsed.data.planned_at ? new Date(parsed.data.planned_at) : undefined;
      const actualAt = parsed.data.actual_at ? new Date(parsed.data.actual_at) : undefined;

      const updated = await prisma.productionMilestone.upsert({
        where: { poId_milestone: { poId: id, milestone: milestone as ProductionMilestoneType } },
        update: { plannedAt, actualAt },
        create: { poId: id, milestone: milestone as ProductionMilestoneType, plannedAt, actualAt },
      });

      if (updated.plannedAt && updated.actualAt && updated.actualAt > updated.plannedAt) {
        await notifyRole({
          roleCode: "RESP_IMPRESSION",
          type: "echeance",
          priority: "high",
          title: "Retard de fabrication",
          body: `Le jalon « ${milestone} » du bon de commande ${po.poNumber} a été atteint en retard.`,
          entityType: "purchase_order",
          entityId: id,
        });
      }

      return reply.send(updated);
    },
  );

  // Réception (Ch. 15 §15.7) : rapprochement automatique commande/livraison.
  fastify.post(
    "/api/v1/purchase-orders/:id/goods-receipts",
    { preHandler: requirePermission("printing", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = goodsReceiptSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const po = await prisma.purchaseOrder.findUnique({ where: { id } });
      if (!po) {
        return reply.code(404).send({ code: "not_found", message: "Bon de commande introuvable." });
      }

      const variance = parsed.data.quantity_received - po.orderedQuantity;
      const tolerance = po.quantityTolerancePct ? (Number(po.quantityTolerancePct) / 100) * po.orderedQuantity : 0;
      const withinTolerance = Math.abs(variance) <= tolerance;

      const receipt = await prisma.goodsReceipt.create({
        data: { poId: id, quantityReceived: parsed.data.quantity_received, variance },
      });

      if (!withinTolerance) {
        await notifyRole({
          roleCode: "RESP_IMPRESSION",
          type: "echeance",
          priority: "high",
          title: "Écart de quantité à la réception",
          body: `Réception du bon de commande ${po.poNumber} : écart de ${variance} exemplaire(s) hors tolérance contractuelle.`,
          entityType: "goods_receipt",
          entityId: receipt.id,
        });
      }

      return reply.code(201).send({ ...receipt, within_tolerance: withinTolerance });
    },
  );

  // Catalogue des points de contrôle qualité (Ch. 14 §14.7) : affiché en cases à
  // cocher sur l'écran de réception.
  fastify.get(
    "/api/v1/qc-checklist-items",
    { preHandler: requirePermission("printing", "consultation") },
    async (_request, reply) => {
      return reply.send({ items: QC_CHECKLIST_ITEMS });
    },
  );

  // Rectification d'une réception mal saisie (règle d'or : toujours pouvoir
  // corriger). On recalcule l'écart avec la quantité commandée.
  fastify.patch(
    "/api/v1/goods-receipts/:id",
    { preHandler: requirePermission("printing", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = goodsReceiptSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const receipt = await prisma.goodsReceipt.findUnique({ where: { id }, include: { po: true } });
      if (!receipt) {
        return reply.code(404).send({ code: "not_found", message: "Réception introuvable." });
      }
      const variance = parsed.data.quantity_received - receipt.po.orderedQuantity;
      const updated = await prisma.goodsReceipt.update({
        where: { id },
        data: { quantityReceived: parsed.data.quantity_received, variance },
        include: { claims: true },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "goods_receipt",
        entityId: id,
        newValues: { quantityReceived: parsed.data.quantity_received, variance },
        ipAddress: request.ip,
      });
      return reply.send(updated);
    },
  );

  fastify.patch(
    "/api/v1/goods-receipts/:id/qc",
    { preHandler: requirePermission("printing", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = qcVerdictSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const updated = await prisma.goodsReceipt.update({
        where: { id },
        data: {
          qcVerdict: parsed.data.verdict,
          // On ne remplace la checklist / le commentaire que s'ils sont fournis,
          // pour ne pas effacer une saisie précédente lors d'une simple
          // rectification du verdict.
          ...(parsed.data.checklist !== undefined ? { qcChecklist: parsed.data.checklist } : {}),
          ...(parsed.data.comment !== undefined ? { qcComment: parsed.data.comment } : {}),
        },
        include: { claims: true },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "goods_receipt",
        entityId: id,
        newValues: { qcVerdict: parsed.data.verdict, qcChecklist: parsed.data.checklist, qcComment: parsed.data.comment },
        ipAddress: request.ip,
      });
      return reply.send(updated);
    },
  );

  // Réclamation fournisseur (Ch. 14 §14.7, Ch. 15 §15.2) : ouverte sur non-conformité.
  fastify.post(
    "/api/v1/goods-receipts/:id/claims",
    { preHandler: requirePermission("printing", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = claimSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const claim = await prisma.supplierClaim.create({ data: { receiptId: id, description: parsed.data.description } });
      return reply.code(201).send(claim);
    },
  );

  fastify.patch(
    "/api/v1/supplier-claims/:id/resolve",
    { preHandler: requirePermission("printing", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = claimResolveSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const updated = await prisma.supplierClaim.update({
        where: { id },
        data: { resolution: parsed.data.resolution, resolvedAt: new Date() },
      });
      return reply.send(updated);
    },
  );

  // Réimpressions (Ch. 15 §15.8) : sous-cycle accéléré, reprend le dossier
  // technique existant (dernier BAT signé), commande directe simplifiée.
  fastify.post(
    "/api/v1/manuscripts/:id/reprints",
    { preHandler: requirePermission("printing", "saisie") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = reprintSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const signedBat = await prisma.batRecord.findFirst({
        where: { manuscriptId: id, status: BatStatus.signed },
        include: { signatures: { orderBy: { signedAt: "desc" }, take: 1 } },
        orderBy: { cycleNumber: "desc" },
      });
      if (!signedBat) {
        return reply.code(409).send({ code: "no_signed_bat", message: "Aucun BAT signé pour ce manuscrit : réimpression impossible." });
      }

      const lastPo = await prisma.purchaseOrder.findFirst({
        where: { quote: { manuscriptId: id } },
        orderBy: { reprintNumber: "desc" },
      });

      const quote = await prisma.printQuote.create({
        data: {
          manuscriptId: id,
          printerId: parsed.data.printer_id,
          quantities: [parsed.data.quantity],
          amounts: { [String(parsed.data.quantity)]: parsed.data.amount },
          status: PrintQuoteStatus.selected,
          selectedQuantity: parsed.data.quantity,
          selectionMotive: "Réimpression — commande directe (Ch. 15 §15.8)",
        },
      });

      const poNumber = await nextPoNumber();
      const po = await prisma.purchaseOrder.create({
        data: {
          quoteId: quote.id,
          printerId: parsed.data.printer_id,
          poNumber,
          orderedQuantity: parsed.data.quantity,
          amount: parsed.data.amount,
          deliveryDue: parsed.data.delivery_due ? new Date(parsed.data.delivery_due) : undefined,
          deliveryLocationId: parsed.data.delivery_location_id,
          filesHashReference: signedBat.signatures[0]?.filesHash,
          reprintNumber: (lastPo?.reprintNumber ?? 0) + 1,
          createdBy: request.user!.id,
        },
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "purchase_order",
        entityId: po.id,
        newValues: { poNumber, reprintNumber: po.reprintNumber },
        ipAddress: request.ip,
      });

      return reply.code(201).send(po);
    },
  );
}
