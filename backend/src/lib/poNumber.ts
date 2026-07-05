import { prisma } from "./prisma.js";

// Numéro de bon de commande généré automatiquement (Ch. 15 §15.4). Même
// mécanisme atomique que pour les contrats (voir contractNumber.ts).
export async function nextPoNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await prisma.$queryRaw<{ last_value: number }[]>`
    INSERT INTO po_number_counters (year, last_value)
    VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = po_number_counters.last_value + 1
    RETURNING last_value
  `;
  const sequence = rows[0].last_value;
  return `PO-${year}-${String(sequence).padStart(4, "0")}`;
}
