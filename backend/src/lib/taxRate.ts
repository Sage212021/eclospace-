import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

// Ch. 18 §18.9 : taux par pays et type de produit, paramétrable. Simplifié à
// un taux "default" en l'absence de pays associé au client (cf.
// docs/JOURNAL_TECHNIQUE.md) — la configuration fiscale précise par pays
// reste à affiner quand les pays de commercialisation seront confirmés.
export async function lookupTaxRatePct(tx: Tx, productType = "livre"): Promise<number> {
  const rate = await tx.taxRate.findUnique({ where: { country_productType: { country: "default", productType } } });
  return rate ? Number(rate.rate) : 0;
}
