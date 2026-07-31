import type { Prisma, PrismaClient } from "@prisma/client";
import { nextInvoiceNumber } from "./invoiceNumber.js";
import { assertPeriodOpen } from "./accountingPeriod.js";
import { recordRoyaltyEntry } from "./royalty.js";
import { recordSchoolRoyaltyEntries } from "./schoolRoyalty.js";
import { lookupTaxRatePct } from "./taxRate.js";

type Tx = Prisma.TransactionClient | PrismaClient;

interface InvoiceLineInput {
  isbnId: string | null;
  manuscriptId: string | null;
  format: string | null;
  description: string;
  quantity: number;
  unitPrice: number; // prix net facturé (après remise)
  // Prix public HT unitaire AVANT remise, quand il diffère du net : assiette des
  // droits d'auteur « prix public HT ». Absent = pas de remise (= unitPrice).
  unitPublicPrice?: number;
  taxRate: number;
}

async function createInvoiceRecord(
  tx: Tx,
  params: {
    customerId: string;
    sourceType: string;
    sourceId: string;
    lines: InvoiceLineInput[];
    status?: "issued" | "paid" | "pending_validation";
    // Remise commerciale globale (0–100 %) : réduit le net à payer (totalTtc) ;
    // le brut (total_ht/total_tax) reste la somme des lignes. N'affecte PAS les
    // droits d'auteur (calculés au prix unitaire de chaque ligne, avant remise).
    discountPct?: number;
  },
) {
  await assertPeriodOpen(tx);
  const invoiceNumber = await nextInvoiceNumber();
  const grossHt = params.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  const grossTax = params.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice * (l.taxRate / 100), 0);
  const discountPct = Math.max(0, Math.min(100, params.discountPct ?? 0));
  // La remise réduit le chiffre d'affaires : on stocke les totaux NETS (après
  // remise) — HT, TVA et TTC. Le BRUT reste reconstituable depuis les lignes
  // (somme des montants), et discountPct permet d'imprimer Total → Remise → NAP.
  const factor = 1 - discountPct / 100;
  const totalHt = grossHt * factor;
  const totalTax = grossTax * factor;
  const totalTtc = totalHt + totalTax;
  // Échéance par défaut à 30 jours (Ch. 18 §18.3) : le cahier des charges ne
  // fixe pas de délai standard ; customer.paymentTerms reste un champ libre
  // non structuré (à affiner avec l'opérateur si des délais différenciés par
  // client sont nécessaires — cf. docs/JOURNAL_TECHNIQUE.md).
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const invoice = await tx.invoice.create({
    data: {
      invoiceNumber,
      type: "invoice",
      customerId: params.customerId,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      totalHt: Math.round(totalHt * 100) / 100,
      totalTax: Math.round(totalTax * 100) / 100,
      discountPct,
      totalTtc: Math.round(totalTtc * 100) / 100,
      dueDate,
      status: params.status ?? "issued",
      lines: {
        create: params.lines.map((l) => ({
          isbnId: l.isbnId ?? undefined,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          unitPublicPrice: l.unitPublicPrice ?? undefined,
          taxRate: l.taxRate,
          lineTotal: Math.round(l.quantity * l.unitPrice * 100) / 100,
        })),
      },
    },
    include: { lines: true },
  });

  for (const line of params.lines) {
    if (!line.manuscriptId || !line.format) continue;
    await recordRoyaltyEntry(tx, {
      manuscriptId: line.manuscriptId,
      format: line.format,
      quantity: line.quantity,
      // Assiette « prix public HT » = prix AVANT remise ; assiette « prix net
      // éditeur » = prix effectivement facturé. Une remise ne doit pas rogner
      // les droits d'un contrat au prix public.
      unitPublicPrice: line.unitPublicPrice ?? line.unitPrice,
      unitNetPrice: line.unitPrice,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
    });
  }

  return invoice;
}

// Ch. 18 §18.2 : génération automatique de la facture depuis une livraison
// (vente ferme) ; les prix/remises/taxes sont ceux de la ligne de commande
// correspondante.
export async function createInvoiceFromDelivery(tx: Tx, deliveryId: string) {
  const delivery = await tx.delivery.findUniqueOrThrow({
    where: { id: deliveryId },
    include: { lines: true, order: { include: { lines: true } } },
  });
  const lines: InvoiceLineInput[] = [];
  for (const deliveryLine of delivery.lines) {
    const orderLine = delivery.order.lines.find((l) => l.isbnId === deliveryLine.isbnId);
    if (!orderLine) continue;
    const isbn = await tx.isbn.findUnique({ where: { id: deliveryLine.isbnId } });
    const publicUnitPrice = Number(orderLine.unitPrice);
    const netUnitPrice = publicUnitPrice * (1 - Number(orderLine.discountPct) / 100);
    lines.push({
      isbnId: deliveryLine.isbnId,
      manuscriptId: isbn?.manuscriptId ?? null,
      format: isbn?.format ?? null,
      description: `Livraison ${delivery.deliveryNumber}`,
      quantity: deliveryLine.quantity,
      unitPrice: netUnitPrice,
      // Prix public HT (avant remise) conservé pour l'assiette des droits.
      unitPublicPrice: publicUnitPrice,
      taxRate: Number(orderLine.taxRate),
    });
  }
  // Frais de port (Ch. 17 §17.5) : facturés une seule fois par commande, sur
  // sa première livraison, jamais sur les livraisons de reliquat suivantes.
  if (!delivery.order.shippingFeeInvoiced && Number(delivery.order.shippingFee) > 0) {
    lines.push({
      isbnId: null,
      manuscriptId: null,
      format: null,
      description: "Frais de port",
      quantity: 1,
      unitPrice: Number(delivery.order.shippingFee),
      taxRate: 0,
    });
    await tx.salesOrder.update({ where: { id: delivery.orderId }, data: { shippingFeeInvoiced: true } });
  }
  return createInvoiceRecord(tx, {
    customerId: delivery.order.customerId,
    sourceType: "delivery",
    sourceId: delivery.id,
    lines,
  });
}

// Ch. 18 §18.2, Ch. 17 §17.6 : seules les ventes relevées et validées en
// dépôt-vente sont facturées et génèrent des droits d'auteur.
export async function createInvoiceFromConsignmentStatement(tx: Tx, statementId: string) {
  const statement = await tx.consignmentStatement.findUniqueOrThrow({
    where: { id: statementId },
    include: { consignment: { include: { isbn: true } } },
  });
  if (statement.quantitySold <= 0) return null;
  const price = await tx.priceList.findFirst({ where: { isbnId: statement.consignment.isbnId }, orderBy: { effectiveFrom: "desc" } });
  const unitPrice = price ? Number(price.price) : 0;
  const taxRate = await lookupTaxRatePct(tx);

  return createInvoiceRecord(tx, {
    customerId: statement.consignment.customerId,
    sourceType: "consignment_statement",
    sourceId: statement.id,
    lines: [
      {
        isbnId: statement.consignment.isbnId,
        manuscriptId: statement.consignment.isbn.manuscriptId,
        format: statement.consignment.isbn.format,
        description: `Relevé de dépôt-vente ${statement.periodStart.toISOString().slice(0, 10)} – ${statement.periodEnd.toISOString().slice(0, 10)}`,
        quantity: statement.quantitySold,
        unitPrice,
        taxRate,
      },
    ],
  });
}

// Ch. 18 §18.2, Ch. 17 §17.7 : vente directe encaissée immédiatement — la
// facture est émise et rapprochée d'un encaissement dans le même mouvement.
export async function createInvoiceFromPosSale(tx: Tx, posSaleId: string) {
  const posSale = await tx.posSale.findUniqueOrThrow({ where: { id: posSaleId }, include: { isbn: true } });
  const taxRate = await lookupTaxRatePct(tx);

  const invoice = await createInvoiceRecord(tx, {
    customerId: (await ensureWalkInCustomer(tx)).id,
    sourceType: "pos_sale",
    sourceId: posSale.id,
    status: "paid",
    lines: [
      {
        isbnId: posSale.isbnId,
        manuscriptId: posSale.isbn.manuscriptId,
        format: posSale.isbn.format,
        description: "Vente au comptoir / salon",
        quantity: posSale.quantity,
        unitPrice: Number(posSale.unitPrice),
        taxRate,
      },
    ],
  });

  const payment = await tx.payment.create({
    data: {
      direction: "in",
      method: posSale.paymentMethod,
      amount: invoice.totalTtc,
    },
  });
  await tx.paymentAllocation.create({
    data: { paymentId: payment.id, invoiceId: invoice.id, amount: invoice.totalTtc },
  });

  return invoice;
}

// Vente directe : pas de fiche client dédiée par acheteur (Ch. 17 §17.7,
// simplification documentée) — rattachée à un client générique unique.
async function ensureWalkInCustomer(tx: Tx) {
  const existing = await tx.customer.findFirst({ where: { name: "Vente directe (comptoir / salon)" } });
  if (existing) return existing;
  return tx.customer.create({ data: { category: "particulier", name: "Vente directe (comptoir / salon)" } });
}

// Compte d'auteur : le module Finance facture toujours un « client ». Pour
// facturer une prestation à un auteur (Partenaire), on maintient un unique
// « client-auteur » miroir, lié au Partenaire (partnerId) et créé à la volée la
// première fois — l'auteur garde une seule identité de référence (le
// Partenaire), le client n'en est que le reflet comptable, dédoublonné.
export async function ensureAuthorCustomer(tx: Tx, partnerId: string) {
  const linked = await tx.customer.findFirst({ where: { partnerId, deletedAt: null } });
  if (linked) return linked;
  const partner = await tx.partner.findUniqueOrThrow({ where: { id: partnerId } });
  return tx.customer.create({
    data: {
      category: "auteur",
      name: `${partner.firstName} ${partner.lastName}`.trim(),
      contactName: partner.penName ?? null,
      email: partner.email ?? null,
      phone: partner.phone ?? null,
      address: partner.address ?? null,
      partnerId: partner.id,
    },
  });
}

// Compte d'auteur (décision opérateur du 10/07/2026) : génère la FACTURE de
// prestation éditoriale à partir d'un DEVIS accepté/signé. Reprend les lignes du
// devis (donc les mêmes montants que ce que l'auteur a validé). Aucune ligne ne
// porte de manuscrit/format → aucun droit d'auteur généré (c'est un service
// vendu, pas une vente de livre). Idempotent : refuse si le devis a déjà sa
// facture.
export async function createInvoiceFromEditorialQuote(tx: Tx, quoteId: string) {
  const quote = await tx.editorialQuote.findUniqueOrThrow({ where: { id: quoteId }, include: { lines: true } });
  if (quote.status !== "accepted") {
    throw new Error("quote_not_accepted");
  }
  if (quote.invoiceId) {
    throw new Error("quote_already_invoiced");
  }

  // Destinataire (choix C) : un client commercial (customer) s'il est fixé,
  // sinon l'auteur (Partenaire), via son client-miroir.
  const customer = quote.customerId
    ? await tx.customer.findUniqueOrThrow({ where: { id: quote.customerId } })
    : await ensureAuthorCustomer(tx, quote.partnerId!);
  const invoice = await createInvoiceRecord(tx, {
    customerId: customer.id,
    sourceType: `${quote.serviceType}_quote`,
    sourceId: quote.id,
    lines: quote.lines.map((l) => ({
      isbnId: null,
      manuscriptId: null, // pas de droits d'auteur sur une prestation
      format: null,
      description: l.description,
      quantity: l.quantity,
      unitPrice: Number(l.unitPrice),
      taxRate: Number(l.taxRate),
    })),
  });

  await tx.editorialQuote.update({
    where: { id: quote.id },
    data: { status: "invoiced", invoiceId: invoice.id },
  });

  return invoice;
}

// Ch. 18 §18.2, Ch. 17 §17.9 : avoir rattaché à la facture d'origine ; les
// prix/taux reprennent ceux de la facture d'origine si elle existe, sinon le
// tarif courant. Recalcul des droits d'auteur pour tous les verdicts (les
// exemplaires ne sont plus vendus, quel que soit leur devenir physique).
export async function createCreditNoteFromReturn(tx: Tx, customerReturnId: string) {
  const customerReturn = await tx.customerReturn.findUniqueOrThrow({
    where: { id: customerReturnId },
    include: { lines: true },
  });
  if (customerReturn.lines.length === 0) return null;

  const originInvoice = customerReturn.originDeliveryId
    ? await tx.invoice.findFirst({ where: { sourceType: "delivery", sourceId: customerReturn.originDeliveryId }, include: { lines: true } })
    : null;

  await assertPeriodOpen(tx);
  const invoiceNumber = await nextInvoiceNumber();
  const lineInputs: InvoiceLineInput[] = [];
  for (const line of customerReturn.lines) {
    const originLine = originInvoice?.lines.find((l) => l.isbnId === line.isbnId);
    const isbn = await tx.isbn.findUnique({ where: { id: line.isbnId } });
    const unitPrice = originLine ? Number(originLine.unitPrice) : Number((await tx.priceList.findFirst({ where: { isbnId: line.isbnId }, orderBy: { effectiveFrom: "desc" } }))?.price ?? 0);
    // Reprend l'assiette « prix public HT » de la facture d'origine pour que le
    // retour contre-passe exactement l'entrée de droits enregistrée à la vente.
    const unitPublicPrice = originLine ? Number(originLine.unitPublicPrice ?? originLine.unitPrice) : unitPrice;
    const taxRate = originLine ? Number(originLine.taxRate) : await lookupTaxRatePct(tx);
    lineInputs.push({
      isbnId: line.isbnId,
      manuscriptId: isbn?.manuscriptId ?? null,
      format: isbn?.format ?? null,
      description: `Retour client — ${line.verdict ?? "à contrôler"}`,
      quantity: line.quantity,
      unitPrice,
      unitPublicPrice,
      taxRate,
    });
  }

  const totalHt = lineInputs.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  const totalTax = lineInputs.reduce((sum, l) => sum + l.quantity * l.unitPrice * (l.taxRate / 100), 0);
  const creditNote = await tx.invoice.create({
    data: {
      invoiceNumber,
      type: "credit_note",
      parentInvoiceId: originInvoice?.id,
      customerId: customerReturn.customerId,
      sourceType: "customer_return",
      sourceId: customerReturn.id,
      totalHt: Math.round(totalHt * 100) / 100,
      totalTax: Math.round(totalTax * 100) / 100,
      totalTtc: Math.round((totalHt + totalTax) * 100) / 100,
      status: "issued",
      lines: {
        create: lineInputs.map((l) => ({
          isbnId: l.isbnId ?? undefined,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          unitPublicPrice: l.unitPublicPrice ?? undefined,
          taxRate: l.taxRate,
          lineTotal: Math.round(l.quantity * l.unitPrice * 100) / 100,
        })),
      },
    },
  });

  for (const line of lineInputs) {
    if (!line.manuscriptId || !line.format) continue;
    await recordRoyaltyEntry(tx, {
      manuscriptId: line.manuscriptId,
      format: line.format,
      quantity: -line.quantity,
      unitPublicPrice: line.unitPublicPrice ?? line.unitPrice,
      unitNetPrice: line.unitPrice,
      sourceType: "customer_return",
      sourceId: customerReturn.id,
    });
  }

  return creditNote;
}

// Avoir (note de crédit) neutralisant une facture précise (Ch. 18 §18.2) : la
// facture étant immuable, on ne la supprime pas — on émet un avoir de mêmes
// montants, rattaché à la facture d'origine (parentInvoiceId). Le chiffre
// d'affaires s'en trouve ramené à zéro pour cette facture (l'avoir compte en
// négatif). Les droits d'auteur des lignes livres sont contre-passés.
export async function createCreditNoteFromInvoice(tx: Tx, invoiceId: string, reason?: string) {
  const origin = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true, creditNotes: true, schoolRoyaltyEntries: true } });
  if (origin.type !== "invoice") throw new Error("not_an_invoice");
  if (origin.creditNotes.length > 0) throw new Error("already_credited");
  await assertPeriodOpen(tx);
  const invoiceNumber = await nextInvoiceNumber();

  const creditNote = await tx.invoice.create({
    data: {
      invoiceNumber,
      type: "credit_note",
      parentInvoiceId: origin.id,
      customerId: origin.customerId,
      sourceType: "invoice_cancellation",
      sourceId: origin.id,
      totalHt: origin.totalHt,
      totalTax: origin.totalTax,
      discountPct: origin.discountPct, // même remise → l'avoir neutralise le net facturé
      totalTtc: origin.totalTtc,
      currency: origin.currency,
      status: "issued",
      cancellationReason: reason?.trim() || null,
      lines: {
        create: origin.lines.map((l) => ({
          isbnId: l.isbnId ?? undefined,
          description: reason ? `${l.description} — avoir : ${reason.trim()}` : `${l.description} — avoir`,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          unitPublicPrice: l.unitPublicPrice ?? undefined,
          taxRate: l.taxRate,
          lineTotal: l.lineTotal,
        })),
      },
    },
    include: { lines: true },
  });

  // Contre-passation des droits d'auteur. Une facture « livre scolaire » a été
  // calculée par le moteur maison : on contre-passe alors ses entrées scolaires
  // (et on n'exécute PAS le moteur « contrat », qui n'a rien enregistré à la
  // vente). Sinon, contre-passation contrat pour les lignes rattachées à un ouvrage.
  if (origin.schoolRoyaltyEntries.length > 0) {
    await recordSchoolRoyaltyEntries(tx, {
      invoiceId: creditNote.id,
      sourceType: "credit_note",
      lines: origin.schoolRoyaltyEntries.map((e) => ({
        invoiceLineId: null,
        isbnId: e.isbnId,
        description: e.bookTitle,
        quantity: -e.quantity,
        unitPriceHt: Number(e.unitPriceHt),
        rate: Number(e.rateApplied),
      })),
    });
  } else {
    for (const l of origin.lines) {
      const isbn = l.isbnId ? await tx.isbn.findUnique({ where: { id: l.isbnId } }) : null;
      if (!isbn?.manuscriptId || !isbn.format) continue;
      await recordRoyaltyEntry(tx, {
        manuscriptId: isbn.manuscriptId,
        format: isbn.format,
        quantity: -l.quantity,
        // Même assiette qu'à la vente : contre-passe exactement l'entrée d'origine.
        unitPublicPrice: Number(l.unitPublicPrice ?? l.unitPrice),
        unitNetPrice: Number(l.unitPrice),
        sourceType: "invoice_cancellation",
        sourceId: origin.id,
      });
    }
  }

  return creditNote;
}

// Facture établie à partir d'une commande à facturer (étape 3). La commande est
// initiée par le DG / le commercial / la Finance ; la Finance la reçoit et
// facture. Validation par seuil : au-dessus du seuil, la facture naît « en
// attente de validation » (le DG doit valider) ; sinon elle est émise.
export async function createInvoiceFromBillingOrder(tx: Tx, orderId: string, thresholdTtc: number, discountPct = 0) {
  const order = await tx.billingOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
  if (order.status !== "pending") throw new Error("order_not_pending");
  if (order.invoiceId) throw new Error("order_already_invoiced");

  const taxRate = Number(order.taxRate);
  const bookLines = order.lines;

  // Commande détaillée par ouvrage (livre scolaire) : une ligne de facture par
  // livre, et calcul des droits d'auteur livre par livre. Les manuscriptId/format
  // sont laissés nuls sur les lignes : le moteur de droits « contrat » ne s'y
  // applique pas — c'est le moteur « livre scolaire » (taux maison) qui prend le
  // relais, pour éviter tout double comptage.
  const lines: InvoiceLineInput[] =
    bookLines.length > 0
      ? bookLines.map((bl) => ({
          isbnId: bl.isbnId,
          manuscriptId: null,
          format: null,
          description: bl.description,
          quantity: bl.quantity,
          unitPrice: Number(bl.unitPriceHt),
          taxRate,
        }))
      : [{ isbnId: null, manuscriptId: null, format: null, description: order.label, quantity: 1, unitPrice: Number(order.amountHt), taxRate }];

  const amountHt = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  const clampedDiscount = Math.max(0, Math.min(100, discountPct));
  // Le seuil de validation s'apprécie sur le NET à payer (après remise).
  const totalTtc = amountHt * (1 + taxRate / 100) * (1 - clampedDiscount / 100);
  const status: "issued" | "pending_validation" = totalTtc >= thresholdTtc && thresholdTtc > 0 ? "pending_validation" : "issued";

  const invoice = await createInvoiceRecord(tx, {
    customerId: order.customerId,
    sourceType: "sales_order",
    sourceId: order.id,
    lines,
    status,
    discountPct: clampedDiscount,
  });

  // Droits d'auteur du livre scolaire : une entrée segmentée par ligne-livre.
  if (bookLines.length > 0) {
    await recordSchoolRoyaltyEntries(tx, {
      invoiceId: invoice.id,
      sourceType: "billing_order_invoice",
      lines: bookLines.map((bl, i) => ({
        invoiceLineId: invoice.lines[i]?.id ?? null,
        isbnId: bl.isbnId,
        description: bl.description,
        quantity: bl.quantity,
        unitPriceHt: Number(bl.unitPriceHt),
        rate: bl.royaltyRate != null ? Number(bl.royaltyRate) : null,
      })),
    });
  }

  await tx.billingOrder.update({ where: { id: order.id }, data: { status: "invoiced", invoiceId: invoice.id } });
  return invoice;
}
