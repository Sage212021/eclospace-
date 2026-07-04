import { prisma } from "./prisma.js";

// Numéro de projet généré automatiquement (Ch. 6 §6.2). Upsert atomique par
// année : la contention concurrente est gérée par PostgreSQL, pas par
// l'application.
export async function nextManuscriptNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await prisma.$queryRaw<{ last_value: number }[]>`
    INSERT INTO manuscript_number_counters (year, last_value)
    VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = manuscript_number_counters.last_value + 1
    RETURNING last_value
  `;
  const sequence = rows[0].last_value;
  return `MS-${year}-${String(sequence).padStart(4, "0")}`;
}
