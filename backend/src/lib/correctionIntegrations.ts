import { prisma } from "./prisma.js";

// « Mes intégrations de correction » — source unique, réutilisée par la page
// dédiée (aiEditorial) ET par « Mes travaux de production » (workflow), pour ne
// pas dupliquer la logique. Renvoie, pour un utilisateur, les ouvrages dont
// l'intégration des corrections lui est confiée, par branche (texte = intégrateur
// éditorial désigné ; couverture = infographe désigné ou responsable Infographie).

export type IntegrationBranch = "texte" | "couverture";
export interface IntegrationCounts { a_integrer: number; integree: number; a_revoir: number; non_applicable: number; total: number }
export interface IntegrationItem {
  id: string; // = manuscriptId
  manuscript_number: string;
  title: string;
  status_code: string;
  status_label: string;
  branch: IntegrationBranch;
  counts: IntegrationCounts;
  closed_at: string | null;
  can_close: boolean;
}

const emptyCounts = (): IntegrationCounts => ({ a_integrer: 0, integree: 0, a_revoir: 0, non_applicable: 0, total: 0 });

async function tally(manuscriptIds: string[], workTypes: ("correction_1" | "correction_2" | "couverture")[]) {
  if (manuscriptIds.length === 0) return new Map<string, IntegrationCounts>();
  const rows = await prisma.correctionAnomaly.findMany({
    where: { manuscriptId: { in: manuscriptIds }, status: { in: ["acceptee", "modifiee"] }, job: { workType: { in: workTypes } } },
    select: { manuscriptId: true, integrationStatus: true },
  });
  const m = new Map<string, IntegrationCounts>();
  for (const r of rows) {
    if (!m.has(r.manuscriptId)) m.set(r.manuscriptId, emptyCounts());
    const c = m.get(r.manuscriptId)!;
    c.total += 1;
    if (r.integrationStatus in c) (c as unknown as Record<string, number>)[r.integrationStatus] += 1;
  }
  return m;
}

// Présence du FICHIER FINAL par branche (autorise la clôture).
async function withFinalFile(manuscriptIds: string[], phaseKey: string) {
  if (manuscriptIds.length === 0) return new Set<string>();
  const docs = await prisma.document.findMany({
    where: { entityType: "manuscript", entityId: { in: manuscriptIds }, category: "piece_etape", deletedAt: null, title: { startsWith: `[correction:${phaseKey}]` } },
    select: { entityId: true },
  });
  return new Set(docs.map((d) => d.entityId));
}

export async function myCorrectionIntegrations(userId: string): Promise<IntegrationItem[]> {
  const me = userId;

  // Branche TEXTE : ouvrages où je suis l'intégrateur éditorial désigné.
  const texteManuscripts = await prisma.manuscript.findMany({
    where: { deletedAt: null, correctionIntegratorId: me },
    select: { id: true, manuscriptNumber: true, title: true, correctionIntegrationClosedAt: true, status: { select: { code: true, label: true } } },
    orderBy: { updatedAt: "desc" },
  });
  const texteCounts = await tally(texteManuscripts.map((m) => m.id), ["correction_1", "correction_2"]);
  const texteFinal = await withFinalFile(texteManuscripts.map((m) => m.id), "integration_finale");

  // Branche COUVERTURE : infographe désigné OU responsable de l'étape Infographie.
  const infoSteps = await prisma.manuscriptStep.findMany({
    where: { responsibleId: me, status: { code: "INFOGRAPHIE" }, manuscript: { deletedAt: null } },
    select: { manuscript: { select: { id: true, manuscriptNumber: true, title: true, coverIntegrationClosedAt: true, status: { select: { code: true, label: true } } } } },
  });
  const designated = await prisma.manuscript.findMany({
    where: { deletedAt: null, coverIntegratorId: me },
    select: { id: true, manuscriptNumber: true, title: true, coverIntegrationClosedAt: true, status: { select: { code: true, label: true } } },
  });
  type CoverM = { id: string; manuscriptNumber: string; title: string; coverIntegrationClosedAt: Date | null; status: { code: string; label: string } };
  const coverById = new Map<string, CoverM>();
  for (const s of infoSteps) coverById.set(s.manuscript.id, s.manuscript);
  for (const m of designated) coverById.set(m.id, m);
  const coverManuscripts = [...coverById.values()];
  const coverCounts = await tally(coverManuscripts.map((m) => m.id), ["couverture"]);
  const coverFinal = await withFinalFile(coverManuscripts.map((m) => m.id), "couverture_finale");

  return [
    ...texteManuscripts.map((m) => ({ id: m.id, manuscript_number: m.manuscriptNumber, title: m.title, status_code: m.status.code, status_label: m.status.label, branch: "texte" as const, counts: texteCounts.get(m.id) ?? emptyCounts(), closed_at: m.correctionIntegrationClosedAt?.toISOString() ?? null, can_close: texteFinal.has(m.id) })),
    ...coverManuscripts.map((m) => ({ id: m.id, manuscript_number: m.manuscriptNumber, title: m.title, status_code: m.status.code, status_label: m.status.label, branch: "couverture" as const, counts: coverCounts.get(m.id) ?? emptyCounts(), closed_at: m.coverIntegrationClosedAt?.toISOString() ?? null, can_close: coverFinal.has(m.id) })),
  ];
}
