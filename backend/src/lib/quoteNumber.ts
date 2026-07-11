import { prisma } from "./prisma.js";

// Numéro de devis de prestation éditoriale généré automatiquement. Même
// mécanisme atomique et infalsifiable que les autres séquences (contrats,
// factures) : un compteur par année, incrément atomique via INSERT … ON
// CONFLICT DO UPDATE.
export async function nextQuoteNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await prisma.$queryRaw<{ last_value: number }[]>`
    INSERT INTO editorial_quote_number_counters (year, last_value)
    VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = editorial_quote_number_counters.last_value + 1
    RETURNING last_value
  `;
  const sequence = rows[0].last_value;
  return `DE-${year}-${String(sequence).padStart(4, "0")}`;
}
