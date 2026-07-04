import { prisma } from "./prisma.js";
import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

export function periodKeyFor(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// Ch. 18 §18.11 : une période clôturée n'accepte plus d'écriture. Les
// périodes sont ouvertes à la volée dès la première écriture du mois.
export async function assertPeriodOpen(tx: Tx, date: Date = new Date()): Promise<void> {
  const periodKey = periodKeyFor(date);
  const period = await tx.accountingPeriod.upsert({
    where: { periodKey },
    update: {},
    create: { periodKey },
  });
  if (period.status === "closed") {
    throw new PeriodClosedError(periodKey);
  }
}

export class PeriodClosedError extends Error {
  constructor(public periodKey: string) {
    super(`La période comptable ${periodKey} est clôturée : aucune nouvelle écriture n'est acceptée.`);
  }
}
