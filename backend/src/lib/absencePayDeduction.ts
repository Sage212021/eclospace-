import { prisma } from "./prisma.js";

// Retenue de paie des absences NON PAYÉES (temps 2 du chantier absences,
// demande opérateur 20/08/2026). Deux modes, au CHOIX du RH via un interrupteur :
//   • MANUEL (défaut) : le RH saisit lui-même la retenue d'absence au bulletin ;
//   • AUTOMATIQUE : la retenue est calculée à partir des absences non payées
//     validées du mois (motifs « payroll_deductible ») et proposée/appliquée ;
//     le RH peut toujours la corriger.
// Convention de journée : salaire journalier = salaire de base / 30 (même base
// « 30 jours » que la déclaration CNPS/DIPE), arrondi au franc.

const SETTINGS_KEY = "absence_auto_deduction";

// L'interrupteur RH « retenue automatique des absences » est-il activé ?
export async function absenceAutoDeductionEnabled(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  return row?.value === true;
}

export async function setAbsenceAutoDeduction(enabled: boolean, userId: string): Promise<boolean> {
  const row = await prisma.setting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: enabled as never, updatedBy: userId },
    update: { value: enabled as never, version: { increment: 1 }, updatedBy: userId },
  });
  return row.value === true;
}

// Bornes du mois "YYYY-MM" (UTC), inclusives.
function monthBounds(period: string): { start: Date; end: Date } {
  const [y, m] = period.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 0)) };
}

// Nombre de jours d'absences NON PAYÉES validées tombant dans le mois (chaque
// absence bornée au mois, jours calendaires inclusifs). Une absence sans motif
// n'est jamais décomptée (pas de règle « non payée » attachée).
export async function unpaidAbsenceDaysInPeriod(employeeId: string, period: string): Promise<number> {
  const { start, end } = monthBounds(period);
  const absences = await prisma.absence.findMany({
    where: {
      employeeId,
      status: "validee",
      fromDate: { lte: end },
      toDate: { gte: start },
      reasonRef: { is: { payrollDeductible: true } },
    },
    select: { fromDate: true, toDate: true },
  });
  let days = 0;
  for (const a of absences) {
    const from = a.fromDate < start ? start : a.fromDate;
    const to = a.toDate > end ? end : a.toDate;
    days += Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  }
  return days;
}

// Retenue calculée pour un employé et un mois, à partir du salaire de base.
export async function computeAbsenceDeduction(
  employeeId: string,
  period: string,
  base: number,
): Promise<{ days: number; daily: number; amount: number }> {
  const days = await unpaidAbsenceDaysInPeriod(employeeId, period);
  const daily = base > 0 ? Math.round(base / 30) : 0;
  const amount = Math.round(daily * days);
  return { days, daily, amount };
}
