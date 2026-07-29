import { prisma } from "./prisma.js";

// Numéro de commande à facturer (CMD-AAAA-NNNN), même mécanisme atomique que les
// autres séquences (devis, factures) : un compteur par année.
export async function nextBillingOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await prisma.$queryRaw<{ last_value: number }[]>`
    INSERT INTO billing_order_number_counters (year, last_value)
    VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = billing_order_number_counters.last_value + 1
    RETURNING last_value
  `;
  return `CMD-${year}-${String(rows[0].last_value).padStart(4, "0")}`;
}
