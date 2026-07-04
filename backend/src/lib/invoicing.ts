import type { Prisma, PrismaClient } from "@prisma/client";
import { nextInvoiceNumber } from "./invoiceNumber.js";
import { assertPeriodOpen } from "./accountingPeriod.js";
import { recordRoyaltyEntry } from "./royalty.js";
import { lookupTaxRatePct } from "./taxRate.js";

type Tx = Prisma.TransactionClient | PrismaClient;

interface InvoiceLineInput {
  isbnId: string | null;
  manuscriptId: string | null;
  format: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

async function createInvoiceRecord(
  tx: Tx,
  params: {
    customerId: string;
    sourceType: string;
    sourceId: string;
    lines: InvoiceLineInput[];
    status?: "issued" | "paid";
  },
) {
  await assertPeriodOpen(tx);
  const invoiceNumber = await nextInvoiceNumber();
  const totalHt = params.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  const totalTax = params.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice * (l.taxRate / 100), 0);
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
      totalTtc: Math.round(totalTtc * 100) / 100,
      dueDate,
      status: params.status ?? "issued",
      lines: {
        create: params.lines.map((l) => ({
          isbnId: l.isbnId ?? undefined,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
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
      unitPublicPrice: line.unitPrice,
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
    const netUnitPrice = Number(orderLine.unitPrice) * (1 - Number(orderLine.discountPct) / 100);
    lines.push({
      isbnId: deliveryLine.isbnId,
      manuscriptId: isbn?.manuscriptId ?? null,
      format: isbn?.format ?? null,
      description: `Livraison ${delivery.deliveryNumber}`,
      quantity: deliveryLine.quantity,
      unitPrice: netUnitPrice,
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
    const taxRate = originLine ? Number(originLine.taxRate) : await lookupTaxRatePct(tx);
    lineInputs.push({
      isbnId: line.isbnId,
      manuscriptId: isbn?.manuscriptId ?? null,
      format: isbn?.format ?? null,
      description: `Retour client — ${line.verdict ?? "à contrôler"}`,
      quantity: line.quantity,
      unitPrice,
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
      unitPublicPrice: line.unitPrice,
      unitNetPrice: line.unitPrice,
      sourceType: "customer_return",
      sourceId: customerReturn.id,
    });
  }

  return creditNote;
}
