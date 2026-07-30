import type { DayResult } from "./attendanceCompute.js";

// Calcul des retenues (incrément 3) — fonctions PURES, testables. §21-22.
// Les montants sont en FCFA (entiers) ; on arrondit le résultat à l'unité.

export type DeductionMethod = "prorata" | "round_half_hour" | "round_hour" | "custom";

export interface DeductionRuleView {
  per_minute: number | null;
  per_half_hour: number;
  per_hour: number;
  daily_cap: number | null;
  monthly_cap: number | null;
  method: DeductionMethod;
}

// Minutes « retenables » d'une journée : le temps dû mais non presté, hors
// justification. Un jour justifié (congé/mission validé) ne génère aucune
// retenue.
//
// Décision opérateur (30/07/2026) : une ABSENCE pleine journée n'est PLUS
// déduite automatiquement du salaire — la présence repose sur la connexion
// Eclospace, information insuffisamment fiable pour retenir sur la paie. La
// rubrique « absences » reste un outil de suivi ; la retenue d'absence n'est
// appliquée que si l'option `deductAbsences` est explicitement activée (quand la
// maison dispose d'un vrai pointeur / registre de présence). Les retards, départs
// anticipés et interruptions (issus d'un pointage réel) restent, eux, retenables.
export function retainableMinutes(day: DayResult, deductAbsences = false): number {
  if (day.justified) return 0;
  if (!day.is_working_day) return 0;
  if (day.absent_full_day) return deductAbsences ? day.expected_minutes : 0;
  return day.late_minutes + day.early_leave_minutes + day.interruption_minutes;
}

// Montant de retenue pour un nombre de minutes, selon la méthode choisie.
export function deductionForMinutes(minutes: number, rule: DeductionRuleView): number {
  if (minutes <= 0) return 0;
  let amount: number;
  switch (rule.method) {
    case "round_half_hour":
      amount = Math.ceil(minutes / 30) * rule.per_half_hour;
      break;
    case "round_hour":
      amount = Math.ceil(minutes / 60) * rule.per_hour;
      break;
    case "custom":
    case "prorata":
    default: {
      // Tarif à la minute : explicite si fourni, sinon déduit de la demi-heure.
      const perMin = rule.per_minute ?? rule.per_half_hour / 30;
      amount = minutes * perMin;
      break;
    }
  }
  return Math.round(amount);
}

export interface DeductionDay {
  date: string;
  retainable_minutes: number;
  amount: number; // après plafond journalier
}

export interface DeductionResult {
  by_day: DeductionDay[];
  total_retainable_minutes: number;
  total_before_monthly_cap: number;
  total_deduction: number; // après plafond mensuel
}

// Applique la règle sur une liste de jours : retenue par jour (plafond
// journalier), puis somme plafonnée au mois. `deductAbsences` (défaut false)
// commande si les absences pleine journée génèrent une retenue.
export function computeDeduction(days: DayResult[], rule: DeductionRuleView, deductAbsences = false): DeductionResult {
  const byDay: DeductionDay[] = [];
  let totalMinutes = 0;
  let totalBefore = 0;
  for (const d of days) {
    const minutes = retainableMinutes(d, deductAbsences);
    let amount = deductionForMinutes(minutes, rule);
    if (rule.daily_cap != null) amount = Math.min(amount, rule.daily_cap);
    totalMinutes += minutes;
    totalBefore += amount;
    if (minutes > 0) byDay.push({ date: d.date, retainable_minutes: minutes, amount });
  }
  const total = rule.monthly_cap != null ? Math.min(totalBefore, rule.monthly_cap) : totalBefore;
  return {
    by_day: byDay,
    total_retainable_minutes: totalMinutes,
    total_before_monthly_cap: totalBefore,
    total_deduction: total,
  };
}
