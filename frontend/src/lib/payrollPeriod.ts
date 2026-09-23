import { useEffect, useState } from "react";
import { getPayrollWorkingPeriod } from "../api/client";

// « Mois traité » partagé par tous les écrans de paie, PERSISTANT (navigateur du
// RH) et par défaut calé sur le dernier mois encore ouvert. Objectif : quand le
// RH finalise août début septembre, tout reste imputé à AOÛT tant qu'il ne
// change pas le mois — et le choix « colle » d'un écran à l'autre.

const STORAGE_KEY = "eclospace.payroll.period";

export function calendarPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
// « 2026-08 » → « août 2026 ».
export function frMonth(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  const idx = Number(m[2]) - 1;
  return `${MONTHS_FR[idx] ?? m[2]} ${m[1]}`;
}

function readStored(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && /^\d{4}-\d{2}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}
function writeStored(period: string): void {
  try { localStorage.setItem(STORAGE_KEY, period); } catch { /* stockage indisponible : sans effet */ }
}

// Hook du mois traité. Ordre de priorité à l'ouverture : choix mémorisé →
// dernier mois ouvert (serveur) → mois calendaire. Chaque changement est mémorisé
// et repris par les autres écrans de paie.
export function usePayrollWorkingPeriod(): { period: string; setPeriod: (p: string) => void; calendarMonth: string } {
  const calendarMonth = calendarPeriod();
  const [period, setPeriodState] = useState<string>(() => readStored() ?? calendarMonth);

  useEffect(() => {
    // Si aucun choix mémorisé, on demande au serveur le dernier mois ouvert.
    if (readStored()) return;
    let cancelled = false;
    getPayrollWorkingPeriod()
      .then((r) => { if (!cancelled && !readStored()) setPeriodState(r.period); })
      .catch(() => { /* on garde le mois calendaire */ });
    return () => { cancelled = true; };
  }, []);

  const setPeriod = (p: string) => { writeStored(p); setPeriodState(p); };
  return { period, setPeriod, calendarMonth };
}
