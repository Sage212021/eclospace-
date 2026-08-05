import { prisma } from "./prisma.js";
import type { TaskType } from "@prisma/client";

// Tableau de bord du sous-module « Correction éditoriale » (refonte du pôle
// éditorial). RÉUTILISE les données déjà en base (manuscrits à l'étape
// CORRECTION, tâches de correction, points bloquants) — aucune double saisie.
// Réservé, côté route, aux rôles éditorial/direction. Additif : n'altère aucun
// autre module.

const DAY = 24 * 60 * 60 * 1000;
const CORRECTION_CODE = "CORRECTION";
const WORKFLOW_TARGET_DAYS_KEY = "workflow.step_target_days";

// Types de tâches relevant de la correction éditoriale (Ch. 10 §10.3).
const CORRECTION_TASK_TYPES: TaskType[] = [
  "correction_ortho",
  "correction_gramm",
  "correction_typo",
  "correction_syntaxe",
  "correction_style",
  "harmonisation",
  "verif_biblio",
  "coherence",
];
const DONE_STATUSES = new Set(["terminee", "validee"]);

// Sous-état d'un manuscrit en correction, pour le menu local (accordéon) :
//  - points_bloquants : au moins un point bloquant non résolu (priorité) ;
//  - a_demarrer : aucune tâche de correction commencée ;
//  - prets_a_valider : toutes les tâches terminées et aucun point bloquant ;
//  - en_cours : correction engagée.
export type CorrectionSubState = "points_bloquants" | "a_demarrer" | "en_cours" | "prets_a_valider";

export interface CorrectionManuscript {
  id: string;
  manuscript_number: string;
  title: string;
  received_at: string;
  sub_state: CorrectionSubState;
  tasks_total: number;
  tasks_done: number;
  blocking: number; // points bloquants non résolus
  progress_pct: number; // avancement moyen des tâches de correction
  en_retard: boolean;
}

export interface CorrectionDashboard {
  en_correction: number;
  a_demarrer: number;
  en_cours: number;
  points_bloquants: number; // manuscrits avec au moins un point bloquant
  prets_a_valider: number;
  points_bloquants_total: number; // total des points bloquants non résolus
  en_retard: number;
  manuscripts: CorrectionManuscript[];
}

export async function correctionDashboard(): Promise<CorrectionDashboard> {
  const now = Date.now();
  const [rows, tasks, setting] = await Promise.all([
    prisma.manuscript.findMany({
      where: { deletedAt: null, status: { code: CORRECTION_CODE } },
      select: { id: true, manuscriptNumber: true, title: true, receivedAt: true },
      orderBy: { receivedAt: "asc" },
    }),
    prisma.task.findMany({
      where: { deletedAt: null, manuscript: { deletedAt: null, status: { code: CORRECTION_CODE } } },
      select: {
        manuscriptId: true,
        type: true,
        status: true,
        progressPct: true,
        comments: { where: { isBlocking: true, resolvedAt: null }, select: { id: true } },
      },
    }),
    prisma.setting.findUnique({ where: { key: WORKFLOW_TARGET_DAYS_KEY } }),
  ]);

  const ids = rows.map((m) => m.id);
  // Entrée à l'étape correction, pour le calcul du retard (à défaut : réception).
  const entryTransitions = ids.length
    ? await prisma.stepTransition.findMany({
        where: { manuscriptId: { in: ids }, toStatusCode: CORRECTION_CODE },
        orderBy: { occurredAt: "asc" },
        select: { manuscriptId: true, occurredAt: true },
      })
    : [];
  const entryAt = new Map<string, Date>();
  for (const t of entryTransitions) if (!entryAt.has(t.manuscriptId)) entryAt.set(t.manuscriptId, t.occurredAt);

  const targetDays = (setting?.value as Record<string, number> | undefined) ?? {};
  const correctionTarget = targetDays[CORRECTION_CODE];

  // Regroupement des tâches par manuscrit.
  const byManuscript = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const arr = byManuscript.get(t.manuscriptId) ?? [];
    arr.push(t);
    byManuscript.set(t.manuscriptId, arr);
  }

  let a_demarrer = 0;
  let en_cours = 0;
  let points_bloquants = 0;
  let prets_a_valider = 0;
  let points_bloquants_total = 0;
  let en_retard = 0;

  const manuscripts: CorrectionManuscript[] = rows.map((m) => {
    const mTasks = byManuscript.get(m.id) ?? [];
    const correctionTasks = mTasks.filter((t) => CORRECTION_TASK_TYPES.includes(t.type));
    const blocking = mTasks.reduce((n, t) => n + t.comments.length, 0);
    points_bloquants_total += blocking;
    const tasks_total = correctionTasks.length;
    const tasks_done = correctionTasks.filter((t) => DONE_STATUSES.has(t.status)).length;
    const progress_pct = tasks_total ? Math.round(correctionTasks.reduce((s, t) => s + t.progressPct, 0) / tasks_total) : 0;

    const start = (entryAt.get(m.id) ?? m.receivedAt).getTime();
    const late = correctionTarget != null && now > start + correctionTarget * DAY;
    if (late) en_retard++;

    let sub_state: CorrectionSubState;
    if (blocking > 0) {
      sub_state = "points_bloquants";
      points_bloquants++;
    } else if (tasks_total === 0 || correctionTasks.every((t) => t.status === "non_commencee")) {
      sub_state = "a_demarrer";
      a_demarrer++;
    } else if (correctionTasks.every((t) => DONE_STATUSES.has(t.status))) {
      sub_state = "prets_a_valider";
      prets_a_valider++;
    } else {
      sub_state = "en_cours";
      en_cours++;
    }

    return {
      id: m.id,
      manuscript_number: m.manuscriptNumber,
      title: m.title,
      received_at: m.receivedAt.toISOString(),
      sub_state,
      tasks_total,
      tasks_done,
      blocking,
      progress_pct,
      en_retard: late,
    };
  });

  return {
    en_correction: rows.length,
    a_demarrer,
    en_cours,
    points_bloquants,
    prets_a_valider,
    points_bloquants_total,
    en_retard,
    manuscripts,
  };
}
