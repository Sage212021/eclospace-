import { prisma } from "./prisma.js";

// Tableau de bord éditorial (refonte workflow — Lot B). Vue de pilotage du
// pôle éditorial : où sont les ouvrages, lesquels sont en retard ou bloqués,
// et les grands indicateurs (taux d'acceptation, temps moyen, contrats,
// fabrication, commercialisation). Réservé à la consultation des manuscrits.

const DAY = 24 * 60 * 60 * 1000;
const WORKFLOW_TARGET_DAYS_KEY = "workflow.step_target_days";

// Plages d'étapes (stepOrder du référentiel de workflow) : mise en page →
// contrôle qualité = « en fabrication » ; commercialisation → suivi = « en
// commercialisation ». Bornes larges pour rester robustes si l'ordre évolue.
const FABRICATION_MIN = 10; // MISE_EN_PAGE
const FABRICATION_MAX = 15; // CONTROLE_QUALITE_IMPRESSION
const COMMERCIAL_MIN = 17; // COMMERCIALISATION
const COMMERCIAL_MAX = 19; // SUIVI_POST_PUBLICATION
const ARCHIVE_CODE = "ARCHIVAGE";

export interface EditorialDashboard {
  total: number;
  actifs: number;
  by_status: { code: string; label: string; step_order: number; count: number }[];
  en_retard: number;
  en_retard_list: { id: string; title: string; reference: string; step_label: string; days_over: number }[];
  bloques: number;
  bloques_list: { id: string; title: string; reference: string; reason: string }[];
  taux_acceptation: number | null; // 0..1
  decisions: { acceptes: number; refuses: number; en_cours: number };
  temps_moyen_jours: number | null; // réception → parution (ouvrages parus)
  contrats_signes: number;
  en_fabrication: number;
  en_commercialisation: number;
}

export async function editorialDashboard(): Promise<EditorialDashboard> {
  const [byStatusRaw, setting, manuscripts, decisions, contratsSignes] = await Promise.all([
    prisma.workflowStatus.findMany({
      orderBy: { stepOrder: "asc" },
      include: { _count: { select: { manuscripts: { where: { deletedAt: null } } } } },
    }),
    prisma.setting.findUnique({ where: { key: WORKFLOW_TARGET_DAYS_KEY } }),
    prisma.manuscript.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        title: true,
        manuscriptNumber: true,
        receivedAt: true,
        publicationDate: true,
        isBackCatalogue: true,
        status: { select: { code: true, label: true, stepOrder: true } },
      },
    }),
    prisma.editorialDecision.groupBy({ by: ["decision"], _count: { _all: true } }),
    prisma.contract.count({ where: { status: "active", deletedAt: null } }),
  ]);

  const targetDays = (setting?.value as Record<string, number> | undefined) ?? {};
  const by_status = byStatusRaw.map((s) => ({ code: s.code, label: s.label, step_order: s.stepOrder, count: s._count.manuscripts }));

  const active = manuscripts.filter((m) => m.status.code !== ARCHIVE_CODE);
  const activeIds = active.map((m) => m.id);

  // Dates d'entrée dans l'étape courante (retard) : dernière transition menant
  // au statut courant de chaque ouvrage. L'étape 1 démarre à la réception.
  const currentCodeById = new Map(active.map((m) => [m.id, m.status.code]));
  const transitions = activeIds.length
    ? await prisma.stepTransition.findMany({
        where: { manuscriptId: { in: activeIds } },
        orderBy: { occurredAt: "asc" },
        select: { manuscriptId: true, toStatusCode: true, occurredAt: true },
      })
    : [];
  const entryByManuscript = new Map<string, Date>();
  for (const tr of transitions) {
    if (tr.toStatusCode === currentCodeById.get(tr.manuscriptId)) entryByManuscript.set(tr.manuscriptId, tr.occurredAt);
  }

  const now = Date.now();
  const en_retard_list: EditorialDashboard["en_retard_list"] = [];
  for (const m of active) {
    const target = targetDays[m.status.code];
    if (target == null) continue; // étape sans délai
    const entry = entryByManuscript.get(m.id) ?? (m.status.stepOrder === 1 ? m.receivedAt : null);
    if (!entry) continue;
    const daysOver = Math.floor((now - (entry.getTime() + target * DAY)) / DAY);
    if (daysOver > 0) {
      en_retard_list.push({ id: m.id, title: m.title, reference: m.manuscriptNumber, step_label: m.status.label, days_over: daysOver });
    }
  }
  en_retard_list.sort((a, b) => b.days_over - a.days_over);

  // Dossiers bloqués : un point bloquant du correcteur non levé empêche la
  // progression (Ch. 10 §10.7). On regroupe par ouvrage.
  const blockingComments = activeIds.length
    ? await prisma.taskComment.findMany({
        where: { isBlocking: true, resolvedAt: null, task: { manuscriptId: { in: activeIds }, deletedAt: null } },
        select: { task: { select: { manuscriptId: true } } },
      })
    : [];
  const blockedIds = new Set(blockingComments.map((c) => c.task.manuscriptId).filter((x): x is string => Boolean(x)));
  const byId = new Map(active.map((m) => [m.id, m]));
  const bloques_list: EditorialDashboard["bloques_list"] = [...blockedIds]
    .map((id) => byId.get(id))
    .filter((m): m is (typeof active)[number] => Boolean(m))
    .map((m) => ({ id: m.id, title: m.title, reference: m.manuscriptNumber, reason: "Point bloquant non levé" }));

  // Taux d'acceptation : parmi les décisions terminales (acceptation(s) / refus).
  let acceptes = 0;
  let refuses = 0;
  let enCours = 0;
  for (const d of decisions) {
    const n = d._count._all;
    if (d.decision === "acceptation" || d.decision === "acceptation_conditions") acceptes += n;
    else if (d.decision === "refus") refuses += n;
    else enCours += n; // revision, attente
  }
  const terminal = acceptes + refuses;
  const taux_acceptation = terminal > 0 ? acceptes / terminal : null;

  // Temps moyen de traitement : réception → parution, sur les ouvrages
  // réellement parus dans l'ERP (hors back-catalogue antidaté).
  const published = manuscripts.filter((m) => m.publicationDate && !m.isBackCatalogue);
  const temps_moyen_jours = published.length
    ? Math.round(published.reduce((sum, m) => sum + (m.publicationDate!.getTime() - m.receivedAt.getTime()) / DAY, 0) / published.length)
    : null;

  const en_fabrication = active.filter((m) => m.status.stepOrder >= FABRICATION_MIN && m.status.stepOrder <= FABRICATION_MAX).length;
  const en_commercialisation = active.filter((m) => m.status.stepOrder >= COMMERCIAL_MIN && m.status.stepOrder <= COMMERCIAL_MAX).length;

  return {
    total: manuscripts.length,
    actifs: active.length,
    by_status,
    en_retard: en_retard_list.length,
    en_retard_list: en_retard_list.slice(0, 20),
    bloques: bloques_list.length,
    bloques_list: bloques_list.slice(0, 20),
    taux_acceptation,
    decisions: { acceptes, refuses, en_cours: enCours },
    temps_moyen_jours,
    contrats_signes: contratsSignes,
    en_fabrication,
    en_commercialisation,
  };
}
