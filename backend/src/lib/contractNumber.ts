import { prisma } from "./prisma.js";

// Numéro de contrat généré automatiquement (Ch. 9 §9.2). Même mécanisme
// atomique que pour les manuscrits (voir manuscriptNumber.ts).
export async function nextContractNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await prisma.$queryRaw<{ last_value: number }[]>`
    INSERT INTO contract_number_counters (year, last_value)
    VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = contract_number_counters.last_value + 1
    RETURNING last_value
  `;
  const sequence = rows[0].last_value;
  return `CT-${year}-${String(sequence).padStart(4, "0")}`;
}
