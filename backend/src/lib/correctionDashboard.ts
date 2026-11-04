import { prisma } from "./prisma.js";
import { correctionProgressBatch, type CorrectionProgress } from "./correctionCycle.js";

// Tableau de bord du sous-module « Correction éditoriale » (refonte du pôle
// éditorial). RÉUTILISE les données déjà en base — en particulier le CIRCUIT
// RÉEL de correction (phases/livrables de `correctionCycle.ts`), et non des
// « tâches ». Le pourcentage d'avancement de chaque manuscrit est calculé sur
// les 8 phases réellement déposées (texte : 1re correction, version intégrée,
// 2e correction, VCF ; couverture : rapport 1re, retour intégration, rapport
// 2e, couverture finale). Aucune double saisie, aucun manuscrit fictif.
// Réservé, côté route, aux rôles éditorial/direction. Additif.

const DAY = 24 * 60 * 60 * 1000;
const CORRECTION_CODE = "CORRECTION";
const WORKFLOW_TARGET_DAYS_KEY = "workflow.step_target_days";

// Sous-état RÉEL d'un manuscrit en correction, déterminé par son état dans le
// processus (et non par le simple fait d'apparaître dans une liste) :
//  - a_affecter : transmis à la correction, AUCUN correcteur affecté, pas démarré ;
//  - a_demarrer : correcteur affecté mais aucune phase déposée (pas commencé) ;
//  - en_cours   : au moins une phase déposée, circuit non terminé ;
//  - prets_a_valider : les 8 phases (texte + couverture) sont déposées.
export type CorrectionSubState = "a_affecter" | "a_demarrer" | "en_cours" | "prets_a_valider";

export interface CorrectionManuscript {
  id: string;
  manuscript_number: string;
  title: string;
  author: string | null;
  received_at: string;
  correction_started_at: string | null; // entrée à l'étape correction
  sub_state: CorrectionSubState;
  // Avancement RÉEL (phases du circuit réellement déposées).
  progress_pct: number;      // 0..100 (phases_done / 8)
  phases_done: number;       // 0..8
  phases_total: number;      // 8
  text_done: number;         // 0..4
  cover_done: number;        // 0..4
  started: boolean;
  in_second_correction: boolean; // 2e correction du texte engagée
  waiting_return: boolean;   // la main est à l'intégrateur (en attente de retour)
  blocking: number;          // points bloquants non résolus
  en_retard: boolean;
  // Responsables (deux axes de regroupement) :
  infographe_id: string | null;   // responsable de production (coverIntegrator)
  infographe_name: string | null;
  correcteur_id: string | null;   // correcteur assigné à l'étape
  correcteur_name: string | null;
}

export interface CorrectionDashboard {
  en_correction: number;
  // États réels (la somme a_affecter+a_demarrer+en_cours+prets_a_valider = en_correction).
  a_affecter: number;
  a_demarrer: number;
  en_cours: number;
  prets_a_valider: number;
  // Vues de pilotage additionnelles (sous-ensembles d'« en_cours »).
  nouveaux_a_traiter: number;   // a_affecter + a_demarrer
  deuxieme_correction: number;  // en 2e correction du texte
  en_attente_retour: number;    // la main est à l'intégrateur
  // Points bloquants et retard.
  points_bloquants: number;       // manuscrits avec au moins un point bloquant
  points_bloquants_total: number; // total des points bloquants non résolus
  en_retard: number;
  taux_moyen: number;             // avancement moyen du pôle (0..100)
  manuscripts: CorrectionManuscript[];
}

export async function correctionDashboard(): Promise<CorrectionDashboard> {
  const now = Date.now();
  const [rows, blockingComments, setting] = await Promise.all([
    prisma.manuscript.findMany({
      where: { deletedAt: null, status: { code: CORRECTION_CODE } },
      select: {
        id: true, manuscriptNumber: true, title: true, receivedAt: true, statusId: true,
        coverIntegrator: { select: { id: true, username: true } },
        workContributors: { where: { role: "author" }, orderBy: { displayOrder: "asc" }, take: 1, select: { partner: { select: { firstName: true, lastName: true, penName: true } } } },
      },
      orderBy: { receivedAt: "asc" },
    }),
    // Points bloquants non résolus, rattachés aux tâches de ces manuscrits.
    prisma.taskComment.findMany({
      where: { isBlocking: true, resolvedAt: null, task: { deletedAt: null, manuscript: { deletedAt: null, status: { code: CORRECTION_CODE } } } },
      select: { task: { select: { manuscriptId: true } } },
    }),
    prisma.setting.findUnique({ where: { key: WORKFLOW_TARGET_DAYS_KEY } }),
  ]);

  const ids = rows.map((m) => m.id);

  // Avancement RÉEL de chaque manuscrit (phases du circuit réellement déposées).
  const progressBy = await correctionProgressBatch(ids);

  // Points bloquants non résolus, comptés par manuscrit.
  const blockingBy = new Map<string, number>();
  for (const c of blockingComments) {
    const mid = c.task?.manuscriptId;
    if (!mid) continue;
    blockingBy.set(mid, (blockingBy.get(mid) ?? 0) + 1);
  }

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

  // Correcteur assigné à l'étape (ManuscriptStep.responsible pour le statut
  // correction) — pour le regroupement « par correcteur » et l'état « à affecter ».
  const correctionStatusId = rows[0]?.statusId;
  const steps = ids.length && correctionStatusId
    ? await prisma.manuscriptStep.findMany({
        where: { manuscriptId: { in: ids }, statusId: correctionStatusId },
        select: { manuscriptId: true, responsible: { select: { id: true, username: true } } },
      })
    : [];
  const correcteurBy = new Map<string, { id: string; username: string } | null>();
  for (const s of steps) correcteurBy.set(s.manuscriptId, s.responsible ?? null);

  const authorName = (p: { firstName: string | null; lastName: string; penName: string | null }): string | null =>
    (p.penName?.trim() || `${p.firstName ?? ""} ${p.lastName}`.trim()) || null;

  const targetDays = (setting?.value as Record<string, number> | undefined) ?? {};
  const correctionTarget = targetDays[CORRECTION_CODE];

  let a_affecter = 0;
  let a_demarrer = 0;
  let en_cours = 0;
  let prets_a_valider = 0;
  let deuxieme_correction = 0;
  let en_attente_retour = 0;
  let points_bloquants = 0;
  let points_bloquants_total = 0;
  let en_retard = 0;
  let sommeAvancement = 0;

  const emptyProgress: CorrectionProgress = { textPhases: [], coverPhases: [], textDone: 0, coverDone: 0, phasesDone: 0, phasesTotal: 8, pct: 0, nextTextActor: "correcteur", started: false, inSecondCorrection: false };

  const manuscripts: CorrectionManuscript[] = rows.map((m) => {
    const prog = progressBy.get(m.id) ?? emptyProgress;
    const correcteur = correcteurBy.get(m.id) ?? null;
    const blocking = blockingBy.get(m.id) ?? 0;
    points_bloquants_total += blocking;
    if (blocking > 0) points_bloquants++;

    const start = (entryAt.get(m.id) ?? m.receivedAt).getTime();
    const late = correctionTarget != null && now > start + correctionTarget * DAY;
    if (late) en_retard++;

    sommeAvancement += prog.pct;

    const done = prog.phasesDone >= prog.phasesTotal;
    const inSecond = prog.started && !done && prog.inSecondCorrection;
    const waiting = prog.started && !done && prog.nextTextActor === "integrateur";
    if (inSecond) deuxieme_correction++;
    if (waiting) en_attente_retour++;

    let sub_state: CorrectionSubState;
    if (done) {
      sub_state = "prets_a_valider";
      prets_a_valider++;
    } else if (!prog.started) {
      if (correcteur) { sub_state = "a_demarrer"; a_demarrer++; }
      else { sub_state = "a_affecter"; a_affecter++; }
    } else {
      sub_state = "en_cours";
      en_cours++;
    }

    const author = m.workContributors[0]?.partner ? authorName(m.workContributors[0].partner) : null;
    const entry = entryAt.get(m.id) ?? null;

    return {
      id: m.id,
      manuscript_number: m.manuscriptNumber,
      title: m.title,
      author,
      received_at: m.receivedAt.toISOString(),
      correction_started_at: entry ? entry.toISOString() : null,
      sub_state,
      progress_pct: prog.pct,
      phases_done: prog.phasesDone,
      phases_total: prog.phasesTotal,
      text_done: prog.textDone,
      cover_done: prog.coverDone,
      started: prog.started,
      in_second_correction: inSecond,
      waiting_return: waiting,
      blocking,
      en_retard: late,
      infographe_id: m.coverIntegrator?.id ?? null,
      infographe_name: m.coverIntegrator?.username ?? null,
      correcteur_id: correcteur?.id ?? null,
      correcteur_name: correcteur?.username ?? null,
    };
  });

  return {
    en_correction: rows.length,
    a_affecter,
    a_demarrer,
    en_cours,
    prets_a_valider,
    nouveaux_a_traiter: a_affecter + a_demarrer,
    deuxieme_correction,
    en_attente_retour,
    points_bloquants,
    points_bloquants_total,
    en_retard,
    taux_moyen: rows.length ? Math.round(sommeAvancement / rows.length) : 0,
    manuscripts,
  };
}
