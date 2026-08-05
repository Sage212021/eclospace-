import { prisma } from "./prisma.js";

// Tableau de bord du sous-module « Direction éditoriale » (refonte du pôle
// éditorial). RÉUTILISE les données déjà en base (manuscrits à l'étape
// DECISION_EDITORIALE, évaluations de lecture, décisions actées) — aucune
// double saisie. Réservé, côté route, aux rôles éditorial/direction. Additif :
// n'altère aucun autre module.

const DAY = 24 * 60 * 60 * 1000;
const DECISION_CODE = "DECISION_EDITORIALE";
const WORKFLOW_TARGET_DAYS_KEY = "workflow.step_target_days";
const SCORE_GAP_KEY = "evaluation_score_gap_threshold";
const DEFAULT_SCORE_GAP_THRESHOLD = 3;

export interface PendingDecision {
  id: string;
  manuscript_number: string;
  title: string;
  received_at: string;
  jours_attente: number; // depuis l'entrée à l'étape décision (ou réception à défaut)
  evaluations: number; // nombre d'avis de lecture remis
  score_moyen: number | null; // moyenne des notes globales
  ecart_avis: boolean; // divergence des avis au-delà du seuil → arbitrage direction
  en_retard: boolean;
}

export interface DecisionHistoryItem {
  id: string;
  manuscript_number: string;
  title: string;
  decision: string;
  decided_at: string;
  motivation: string;
}

export interface EditorialDecisionDashboard {
  en_attente: number;
  avis_divergents: number;
  en_retard: number;
  taux_acceptation: number | null; // 0..1, sur les décisions terminales
  delai_moyen_decision_jours: number | null; // entrée à l'étape → décision
  pending: PendingDecision[];
  historique: DecisionHistoryItem[];
}

export async function editorialDecisionDashboard(): Promise<EditorialDecisionDashboard> {
  const now = Date.now();
  const [pendingRows, decisions, targetSetting, gapSetting] = await Promise.all([
    prisma.manuscript.findMany({
      where: { deletedAt: null, status: { code: DECISION_CODE } },
      select: { id: true, manuscriptNumber: true, title: true, receivedAt: true },
      orderBy: { receivedAt: "asc" },
    }),
    prisma.editorialDecision.findMany({
      orderBy: { decidedAt: "desc" },
      select: {
        id: true,
        decision: true,
        decidedAt: true,
        motivation: true,
        manuscriptId: true,
        manuscript: { select: { manuscriptNumber: true, title: true, receivedAt: true } },
      },
    }),
    prisma.setting.findUnique({ where: { key: WORKFLOW_TARGET_DAYS_KEY } }),
    prisma.setting.findUnique({ where: { key: SCORE_GAP_KEY } }),
  ]);

  const gapThreshold = (gapSetting?.value as number | undefined) ?? DEFAULT_SCORE_GAP_THRESHOLD;
  const targetDays = (targetSetting?.value as Record<string, number> | undefined) ?? {};
  const decisionTarget = targetDays[DECISION_CODE];

  const pendingIds = pendingRows.map((m) => m.id);

  // Avis de lecture des manuscrits en attente (synthèse : nombre, moyenne, écart).
  const evaluations = pendingIds.length
    ? await prisma.evaluation.findMany({
        where: { assignment: { manuscriptId: { in: pendingIds } } },
        select: { globalScore: true, assignment: { select: { manuscriptId: true } } },
      })
    : [];
  const scoresByManuscript = new Map<string, number[]>();
  for (const e of evaluations) {
    const mid = e.assignment.manuscriptId;
    const arr = scoresByManuscript.get(mid) ?? [];
    arr.push(Number(e.globalScore));
    scoresByManuscript.set(mid, arr);
  }

  // Date d'entrée à l'étape décision, pour le délai d'attente (à défaut : réception).
  const entryTransitions = pendingIds.length
    ? await prisma.stepTransition.findMany({
        where: { manuscriptId: { in: pendingIds }, toStatusCode: DECISION_CODE },
        orderBy: { occurredAt: "asc" },
        select: { manuscriptId: true, occurredAt: true },
      })
    : [];
  const entryAt = new Map<string, Date>();
  for (const t of entryTransitions) if (!entryAt.has(t.manuscriptId)) entryAt.set(t.manuscriptId, t.occurredAt);

  let avis_divergents = 0;
  let en_retard = 0;
  const pending: PendingDecision[] = pendingRows.map((m) => {
    const scores = scoresByManuscript.get(m.id) ?? [];
    const score_moyen = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null;
    const ecart_avis = scores.length > 1 && Math.max(...scores) - Math.min(...scores) >= gapThreshold;
    if (ecart_avis) avis_divergents++;
    const start = (entryAt.get(m.id) ?? m.receivedAt).getTime();
    const jours_attente = Math.max(0, Math.floor((now - start) / DAY));
    const late = decisionTarget != null && now > start + decisionTarget * DAY;
    if (late) en_retard++;
    return {
      id: m.id,
      manuscript_number: m.manuscriptNumber,
      title: m.title,
      received_at: m.receivedAt.toISOString(),
      jours_attente,
      evaluations: scores.length,
      score_moyen,
      ecart_avis,
      en_retard: late,
    };
  });

  // Taux d'acceptation et délai moyen de décision, sur les décisions terminales.
  let acceptes = 0;
  let refuses = 0;
  const delais: number[] = [];
  const decidedManuscriptIds = Array.from(new Set(decisions.map((d) => d.manuscriptId)));
  const decisionEntry = decidedManuscriptIds.length
    ? await prisma.stepTransition.findMany({
        where: { manuscriptId: { in: decidedManuscriptIds }, toStatusCode: DECISION_CODE },
        orderBy: { occurredAt: "asc" },
        select: { manuscriptId: true, occurredAt: true },
      })
    : [];
  const decisionEntryAt = new Map<string, Date>();
  for (const t of decisionEntry) if (!decisionEntryAt.has(t.manuscriptId)) decisionEntryAt.set(t.manuscriptId, t.occurredAt);

  for (const d of decisions) {
    if (d.decision === "acceptation" || d.decision === "acceptation_conditions") acceptes++;
    else if (d.decision === "refus") refuses++;
    if (["acceptation", "acceptation_conditions", "refus"].includes(d.decision)) {
      const start = decisionEntryAt.get(d.manuscriptId) ?? d.manuscript?.receivedAt;
      if (start) {
        const j = (d.decidedAt.getTime() - start.getTime()) / DAY;
        if (j >= 0) delais.push(j);
      }
    }
  }
  const terminal = acceptes + refuses;
  const taux_acceptation = terminal > 0 ? acceptes / terminal : null;
  const delai_moyen_decision_jours = delais.length ? Math.round(delais.reduce((a, b) => a + b, 0) / delais.length) : null;

  const historique: DecisionHistoryItem[] = decisions.slice(0, 25).map((d) => ({
    id: d.id,
    manuscript_number: d.manuscript?.manuscriptNumber ?? "—",
    title: d.manuscript?.title ?? "—",
    decision: d.decision,
    decided_at: d.decidedAt.toISOString(),
    motivation: d.motivation,
  }));

  return {
    en_attente: pending.length,
    avis_divergents,
    en_retard,
    taux_acceptation,
    delai_moyen_decision_jours,
    pending,
    historique,
  };
}
