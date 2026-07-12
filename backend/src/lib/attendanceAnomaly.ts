import type { DayResult } from "./attendanceCompute.js";

// Détection d'anomalies + machine à états (incrément 4) — fonctions PURES,
// testables. §19 (détection), §23 (statuts), §25 (décisions).

export interface AnomalyThresholds {
  lateMin: number; // retard « important » à partir de N minutes
  earlyMin: number; // départ anticipé notable à partir de N minutes
}

export const DEFAULT_THRESHOLDS: AnomalyThresholds = { lateMin: 15, earlyMin: 15 };

export interface DetectedAnomaly {
  day: string;
  type: "retard" | "depart_anticipe" | "absence";
  minutes: number | null;
  detail: string | null;
}

// À partir des journées calculées, repère les situations anormales (§19).
// Les jours justifiés (congé/mission validé) ne génèrent pas d'anomalie.
export function detectAnomalies(days: DayResult[], t: AnomalyThresholds = DEFAULT_THRESHOLDS): DetectedAnomaly[] {
  const out: DetectedAnomaly[] = [];
  for (const d of days) {
    if (!d.is_working_day || d.justified) continue;
    if (d.absent_full_day) {
      out.push({ day: d.date, type: "absence", minutes: d.expected_minutes, detail: "Absence pleine journée sans justificatif" });
      continue; // une absence pleine journée n'est ni un retard ni un départ.
    }
    if (d.late_minutes >= t.lateMin) {
      out.push({ day: d.date, type: "retard", minutes: d.late_minutes, detail: `Retard de ${d.late_minutes} min` });
    }
    if (d.early_leave_minutes >= t.earlyMin) {
      out.push({ day: d.date, type: "depart_anticipe", minutes: d.early_leave_minutes, detail: `Départ anticipé de ${d.early_leave_minutes} min` });
    }
  }
  return out;
}

export type AnomalyStatus = "en_attente" | "en_analyse" | "validee" | "rejetee" | "corrigee" | "annulee";
export type AnomalyAction = "analyser" | "valider" | "rejeter" | "corriger" | "annuler" | "demander_correction";

// Statuts terminaux : plus aucune décision possible (sauf réouverture non gérée
// à ce stade). On refuse d'agir dessus (409).
const TERMINAL: AnomalyStatus[] = ["validee", "annulee"];

const ACTION_TARGET: Record<AnomalyAction, AnomalyStatus> = {
  analyser: "en_analyse",
  valider: "validee",
  rejeter: "rejetee",
  corriger: "corrigee",
  annuler: "annulee",
  demander_correction: "en_attente",
};

// La décision est-elle applicable depuis le statut courant ?
export function canTransition(current: AnomalyStatus, action: AnomalyAction): boolean {
  if (TERMINAL.includes(current)) return false;
  return action in ACTION_TARGET;
}

export function nextStatus(action: AnomalyAction): AnomalyStatus {
  return ACTION_TARGET[action];
}
