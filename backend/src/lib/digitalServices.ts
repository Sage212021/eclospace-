import type { Prisma } from "@prisma/client";

// Veille des abonnements : calcul du STATUT d'un service numérique à partir de
// son échéance et (pour les forfaits à l'usage) de sa consommation du mois.
//   • à jour        : échéance lointaine et budget sous contrôle ;
//   • à surveiller  : échéance ≤ 15 jours OU consommation ≥ 70 % du budget ;
//   • en retard     : échéance dépassée OU consommation ≥ 95 % du budget.

export type ServiceStatus = "a_jour" | "a_surveiller" | "en_retard";

export interface ServiceView {
  status: ServiceStatus;
  daysToDue: number | null; // négatif = dépassé
  usagePct: number | null;
}

const num = (d: Prisma.Decimal | null | undefined): number | null => (d == null ? null : Number(d));

export function computeServiceView(
  s: { nextDueDate: Date | null; kind: string; monthlyBudget: Prisma.Decimal | null; currentUsage: Prisma.Decimal | null },
  now: Date = new Date(),
): ServiceView {
  let daysToDue: number | null = null;
  if (s.nextDueDate) {
    const ms = new Date(s.nextDueDate).getTime() - now.getTime();
    daysToDue = Math.ceil(ms / 86_400_000);
  }

  let usagePct: number | null = null;
  const budget = num(s.monthlyBudget);
  const usage = num(s.currentUsage);
  if (s.kind === "usage_based" && budget != null && budget > 0 && usage != null) {
    usagePct = Math.round((usage / budget) * 100);
  }

  // Statut = le plus sévère entre l'échéance et la consommation.
  let status: ServiceStatus = "a_jour";
  if (daysToDue != null) {
    if (daysToDue < 0) status = "en_retard";
    else if (daysToDue <= 15) status = "a_surveiller";
  }
  if (usagePct != null) {
    if (usagePct >= 95) status = "en_retard";
    else if (usagePct >= 70 && status === "a_jour") status = "a_surveiller";
  }

  return { status, daysToDue, usagePct };
}
