import { prisma } from "./prisma.js";

// Source UNIQUE des primes de paie (décision opérateur 09/09/2026) : la ligne de
// paie mensuelle d'un salarié porte, dans son champ `primes`, la SOMME de ses
// primes VALIDÉES du module « Primes du mois » pour ce mois. Ces fonctions
// recalculent ce total à partir des primes validées (jamais une addition
// incrémentale : on relit toujours la vérité, ce qui rend l'opération idempotente
// et réversible — validation, annulation, correction). Le champ n'est plus saisi
// à la main dans la grille de paie.

// Somme des primes validées (non supprimées) d'un salarié pour un mois.
export async function validatedPrimesTotal(periodKey: string, employeeId: string): Promise<number> {
  const agg = await prisma.prime.aggregate({
    where: { periodKey, employeeId, status: "validee", deletedAt: null },
    _sum: { amount: true },
  });
  return Number(agg._sum.amount ?? 0);
}

// Recalcule la ligne de paie d'UN salarié pour un mois si un mois de paie est
// déjà préparé (sinon rien : les primes seront intégrées à la préparation du
// mois via syncRunPrimes). La ligne est créée à la volée si besoin.
export async function syncPayrollLinePrimes(periodKey: string, employeeId: string): Promise<void> {
  const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey } });
  if (!run) return;
  const total = await validatedPrimesTotal(periodKey, employeeId);
  await prisma.payrollMonthlyLine.upsert({
    where: { runId_employeeId: { runId: run.id, employeeId } },
    update: { primes: total },
    create: { runId: run.id, employeeId, primes: total },
  });
}

// Recalcule les primes de TOUTES les lignes d'un mois préparé à partir des primes
// validées. Appelé à la préparation / au remplissage d'un mois pour que les
// primes déjà validées y soient reportées.
export async function syncRunPrimes(periodKey: string, runId: string): Promise<void> {
  const grouped = await prisma.prime.groupBy({
    by: ["employeeId"],
    where: { periodKey, status: "validee", deletedAt: null },
    _sum: { amount: true },
  });
  for (const g of grouped) {
    await prisma.payrollMonthlyLine.upsert({
      where: { runId_employeeId: { runId, employeeId: g.employeeId } },
      update: { primes: Number(g._sum.amount ?? 0) },
      create: { runId, employeeId: g.employeeId, primes: Number(g._sum.amount ?? 0) },
    });
  }
}
