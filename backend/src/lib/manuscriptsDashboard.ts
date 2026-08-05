import { prisma } from "./prisma.js";

// Tableau de bord du sous-module « Manuscrits » (refonte du pôle éditorial).
// Indicateurs de pilotage du flux des manuscrits — RÉUTILISE les données déjà
// en base (aucune double saisie). Réservé, côté route, aux rôles éditorial/
// direction. Additif : n'altère aucun autre module.

const DAY = 24 * 60 * 60 * 1000;
const WORKFLOW_TARGET_DAYS_KEY = "workflow.step_target_days";
const ARCHIVE_CODE = "ARCHIVAGE";

export interface ManuscriptsDashboard {
  recus: number; // total des manuscrits (hors supprimés)
  en_evaluation: number; // au comité de lecture
  en_attente: number; // en attente de décision éditoriale
  acceptes: number;
  refuses: number;
  taux_acceptation: number | null; // 0..1
  delai_moyen_traitement_jours: number | null; // réception → décision éditoriale
  en_retard: number; // étape courante au-delà de son délai cible
  by_status: { code: string; label: string; step_order: number; count: number }[];
}

export async function manuscriptsDashboard(): Promise<ManuscriptsDashboard> {
  const [byStatusRaw, decisions, decisionRows, setting, active] = await Promise.all([
    prisma.workflowStatus.findMany({
      orderBy: { stepOrder: "asc" },
      include: { _count: { select: { manuscripts: { where: { deletedAt: null } } } } },
    }),
    prisma.editorialDecision.groupBy({ by: ["decision"], _count: { _all: true } }),
    // Délai réception → décision : on joint la date de réception du manuscrit.
    prisma.editorialDecision.findMany({
      select: { decidedAt: true, manuscript: { select: { receivedAt: true } } },
    }),
    prisma.setting.findUnique({ where: { key: WORKFLOW_TARGET_DAYS_KEY } }),
    prisma.manuscript.findMany({
      where: { deletedAt: null },
      select: { id: true, receivedAt: true, status: { select: { code: true, stepOrder: true } } },
    }),
  ]);

  const by_status = byStatusRaw.map((s) => ({ code: s.code, label: s.label, step_order: s.stepOrder, count: s._count.manuscripts }));
  const countAt = (code: string) => by_status.find((s) => s.code === code)?.count ?? 0;
  const recus = active.length;

  // Décisions : taux d'acceptation (parmi les décisions terminales).
  let acceptes = 0;
  let refuses = 0;
  for (const d of decisions) {
    const n = d._count._all;
    if (d.decision === "acceptation" || d.decision === "acceptation_conditions") acceptes += n;
    else if (d.decision === "refus") refuses += n;
  }
  const terminal = acceptes + refuses;
  const taux_acceptation = terminal > 0 ? acceptes / terminal : null;

  // Délai moyen de traitement (réception → décision), en jours.
  const delais = decisionRows
    .filter((r) => r.manuscript?.receivedAt)
    .map((r) => (r.decidedAt.getTime() - r.manuscript!.receivedAt.getTime()) / DAY)
    .filter((d) => d >= 0);
  const delai_moyen_traitement_jours = delais.length ? Math.round(delais.reduce((a, b) => a + b, 0) / delais.length) : null;

  // Dossiers en retard : étape courante dépassant son délai cible (paramètre).
  const targetDays = (setting?.value as Record<string, number> | undefined) ?? {};
  const activeNonArchived = active.filter((m) => m.status.code !== ARCHIVE_CODE);
  const activeIds = activeNonArchived.map((m) => m.id);
  const transitions = activeIds.length
    ? await prisma.stepTransition.findMany({
        where: { manuscriptId: { in: activeIds } },
        orderBy: { occurredAt: "asc" },
        select: { manuscriptId: true, toStatusCode: true, occurredAt: true },
      })
    : [];
  const currentCode = new Map(activeNonArchived.map((m) => [m.id, m.status.code]));
  const entry = new Map<string, Date>();
  for (const tr of transitions) if (tr.toStatusCode === currentCode.get(tr.manuscriptId)) entry.set(tr.manuscriptId, tr.occurredAt);
  const now = Date.now();
  let en_retard = 0;
  for (const m of activeNonArchived) {
    const target = targetDays[m.status.code];
    if (target == null) continue;
    const start = entry.get(m.id) ?? (m.status.stepOrder === 1 ? m.receivedAt : null);
    if (start && now > start.getTime() + target * DAY) en_retard++;
  }

  return {
    recus,
    en_evaluation: countAt("COMITE_LECTURE"),
    en_attente: countAt("DECISION_EDITORIALE"),
    acceptes,
    refuses,
    taux_acceptation,
    delai_moyen_traitement_jours,
    en_retard,
    by_status,
  };
}
