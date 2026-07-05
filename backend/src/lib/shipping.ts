import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

// Frais de port paramétrables par zone (ajouté hors cahier des charges
// initial — cf. docs/JOURNAL_TECHNIQUE.md, demande opérateur du 04/07/2026).
// Priorité : gratuité au-delà d'un seuil de commande, puis tarif au
// kilogramme, puis forfait. Les trois valeurs sont indépendantes ; le
// financier peut n'en renseigner qu'une seule.
export async function computeShippingFee(tx: Tx, customerId: string, totalWeightGrams: number, orderSubtotal: number): Promise<number> {
  const customer = await tx.customer.findUnique({ where: { id: customerId } });
  if (!customer?.shippingZone) return 0;

  const rate = await tx.shippingRate.findUnique({ where: { zone: customer.shippingZone } });
  if (!rate) return 0;

  if (rate.freeAboveAmount !== null && orderSubtotal >= Number(rate.freeAboveAmount)) return 0;
  if (rate.perKgAmount !== null) {
    const weightKg = totalWeightGrams / 1000;
    return Math.round(weightKg * Number(rate.perKgAmount) * 100) / 100;
  }
  if (rate.flatAmount !== null) return Number(rate.flatAmount);
  return 0;
}

export async function computeOrderWeightGrams(tx: Tx, lines: { isbn_id: string; quantity: number }[]): Promise<number> {
  let totalGrams = 0;
  for (const line of lines) {
    const isbn = await tx.isbn.findUnique({ where: { id: line.isbn_id }, include: { manuscript: { include: { workMetadata: true } } } });
    const unitWeight = isbn?.manuscript?.workMetadata?.weightGrams ?? 0;
    totalGrams += unitWeight * line.quantity;
  }
  return totalGrams;
}
