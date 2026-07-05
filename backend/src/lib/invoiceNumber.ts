import { prisma } from "./prisma.js";

// Numérotation chronologique continue et infalsifiable (Ch. 18 §18.2,
// exigence légale). Même mécanisme atomique que les autres séquences —
// une seule séquence pour factures et avoirs (continuité exigée par le texte).
export async function nextInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await prisma.$queryRaw<{ last_value: number }[]>`
    INSERT INTO invoice_number_counters (year, last_value)
    VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = invoice_number_counters.last_value + 1
    RETURNING last_value
  `;
  const sequence = rows[0].last_value;
  return `FA-${year}-${String(sequence).padStart(5, "0")}`;
}
