import { prisma } from "./prisma.js";
import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

// Ch. 16 §16.1 : le stock affiché doit toujours refléter la réalité
// physique — le disponible est toujours calculé, jamais stocké (§16.5).
export function availableQuantity(item: { quantityPhysical: number; quantityReserved: number }): number {
  return item.quantityPhysical - item.quantityReserved;
}

export async function getOrCreateStockItem(tx: Tx, isbnId: string, locationId: string, printRun: number) {
  return tx.stockItem.upsert({
    where: { isbnId_locationId_printRun: { isbnId, locationId, printRun } },
    update: {},
    create: { isbnId, locationId, printRun },
  });
}

// Applique un delta atomique au stock physique/réservé d'un (isbn, lieu, tirage).
export async function adjustStockItem(
  tx: Tx,
  isbnId: string,
  locationId: string,
  printRun: number,
  deltaPhysical: number,
  deltaReserved = 0,
) {
  const item = await getOrCreateStockItem(tx, isbnId, locationId, printRun);
  return tx.stockItem.update({
    where: { id: item.id },
    data: {
      quantityPhysical: item.quantityPhysical + deltaPhysical,
      quantityReserved: item.quantityReserved + deltaReserved,
    },
  });
}
