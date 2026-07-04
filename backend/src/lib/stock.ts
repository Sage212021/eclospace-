import { prisma } from "./prisma.js";
import type { Prisma, PrismaClient, StockItemCondition } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

// Ch. 16 §16.1 : le stock affiché doit toujours refléter la réalité
// physique — le disponible est toujours calculé, jamais stocké (§16.5).
export function availableQuantity(item: { quantityPhysical: number; quantityReserved: number }): number {
  return item.quantityPhysical - item.quantityReserved;
}

export async function getOrCreateStockItem(
  tx: Tx,
  isbnId: string,
  locationId: string,
  printRun: number,
  condition: StockItemCondition = "vendable",
) {
  return tx.stockItem.upsert({
    where: { isbnId_locationId_printRun_condition: { isbnId, locationId, printRun, condition } },
    update: {},
    create: { isbnId, locationId, printRun, condition },
  });
}

// Applique un delta atomique au stock physique/réservé d'un (isbn, lieu,
// tirage, état). Le stock déclassé (Ch. 16 §16.7) est un compartiment séparé
// du stock vendable normal, jamais mélangé dans le même total.
export async function adjustStockItem(
  tx: Tx,
  isbnId: string,
  locationId: string,
  printRun: number,
  deltaPhysical: number,
  deltaReserved = 0,
  condition: StockItemCondition = "vendable",
) {
  const item = await getOrCreateStockItem(tx, isbnId, locationId, printRun, condition);
  return tx.stockItem.update({
    where: { id: item.id },
    data: {
      quantityPhysical: item.quantityPhysical + deltaPhysical,
      quantityReserved: item.quantityReserved + deltaReserved,
    },
  });
}
