import { prisma } from "./prisma.js";

// Numéro de commande généré automatiquement (Ch. 17 §17.5). Même mécanisme
// atomique que pour les contrats et les bons de commande d'impression.
export async function nextSalesOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await prisma.$queryRaw<{ last_value: number }[]>`
    INSERT INTO sales_order_number_counters (year, last_value)
    VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = sales_order_number_counters.last_value + 1
    RETURNING last_value
  `;
  const sequence = rows[0].last_value;
  return `CMD-${year}-${String(sequence).padStart(4, "0")}`;
}

// Numéro de bon de livraison (Ch. 17 §17.8).
export async function nextDeliveryNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await prisma.$queryRaw<{ last_value: number }[]>`
    INSERT INTO delivery_number_counters (year, last_value)
    VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = delivery_number_counters.last_value + 1
    RETURNING last_value
  `;
  const sequence = rows[0].last_value;
  return `BL-${year}-${String(sequence).padStart(4, "0")}`;
}
