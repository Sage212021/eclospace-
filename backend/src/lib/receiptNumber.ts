import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

// Numérotation des reçus de paiement auteur : REC-AAAA-NNNNNN, séquentielle,
// unique, continue par exercice, atomique (aucun doublon possible), infalsifiable.
// Même mécanisme que la séquence de facturation. Accepte un client de transaction
// (émission d'un reçu de remplacement dans la même transaction que l'annulation).
type SqlClient = Pick<typeof prisma, "$queryRaw"> | Prisma.TransactionClient;
export async function nextReceiptNumber(client: SqlClient = prisma): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await client.$queryRaw<{ last_value: number }[]>`
    INSERT INTO receipt_number_counters (year, last_value)
    VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = receipt_number_counters.last_value + 1
    RETURNING last_value
  `;
  const sequence = rows[0].last_value;
  return `REC-${year}-${String(sequence).padStart(6, "0")}`;
}
