import { prisma } from "./prisma.js";

// Correction éditoriale en DEUX temps (demande opérateur 20/08/2026) :
//   1. le correcteur rend un RAPPORT de correction (vu par l'étape suivante) ;
//   2. INTÉGRATION des corrections dans le texte ;
//   3. DEUXIÈME relecture de correction ;
//   4. INTÉGRATION FINALE + validation.
// Chaque livrable est un document « pièce d'étape » identifié par un préfixe
// stable dans son titre : on peut ainsi lister les phases et vérifier les
// livrables obligatoires SANS colonne dédiée (aucune migration).

export interface CorrectionPhase {
  key: string;
  label: string;
  required: boolean; // bloque la validation de l'étape Correction tant qu'absent
}

// Acteur attendu pour chaque phase : le CORRECTEUR corrige (1re et 2e passages),
// l'ÉDITEUR intègre (versions intégrées). Sert au relais « à qui la main ».
export type CorrectionActor = "correcteur" | "integrateur";
export const CORRECTION_PHASES: (CorrectionPhase & { actor: CorrectionActor })[] = [
  { key: "rapport_1", label: "1re correction", required: true, actor: "correcteur" },
  { key: "integration_1", label: "Version intégrée", required: false, actor: "integrateur" },
  { key: "relecture_2", label: "2e correction (relecture)", required: false, actor: "correcteur" },
  { key: "integration_finale", label: "Version corrigée finale (VCF)", required: true, actor: "integrateur" },
];

const PHASE_KEYS = new Set(CORRECTION_PHASES.map((p) => p.key));
export function isCorrectionPhase(key: string): boolean {
  return PHASE_KEYS.has(key);
}

// Titre stable d'un document de phase : « [correction:<clé>] <fichier> ».
const PREFIX = "[correction:";
export function correctionDocTitle(key: string, filename: string): string {
  return `${PREFIX}${key}] ${filename}`.slice(0, 200);
}
export function parseCorrectionPhaseKey(title: string): string | null {
  const m = /^\[correction:([a-z0-9_]+)\]/.exec(title);
  return m ? m[1] : null;
}

// Livrables de correction déjà déposés pour un manuscrit, groupés par phase
// (on garde le dépôt le plus récent par phase).
export async function correctionCycleState(manuscriptId: string) {
  const docs = await prisma.document.findMany({
    where: { entityType: "manuscript", entityId: manuscriptId, category: "piece_etape", deletedAt: null, title: { startsWith: PREFIX } },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, createdAt: true, createdBy: true, versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true, fileSize: true, mimeType: true } } },
  });
  const latestByPhase = new Map<string, (typeof docs)[number]>();
  for (const d of docs) {
    const key = parseCorrectionPhaseKey(d.title);
    if (key && !latestByPhase.has(key)) latestByPhase.set(key, d);
  }
  return CORRECTION_PHASES.map((p) => {
    const d = latestByPhase.get(p.key);
    const v = d?.versions[0];
    const filename = d ? d.title.replace(/^\[correction:[a-z0-9_]+\]\s*/, "") : null;
    return {
      key: p.key,
      label: p.label,
      required: p.required,
      has_file: Boolean(v),
      doc_id: d?.id ?? null,
      uploaded_by: d?.createdBy ?? null,
      version_id: v?.id ?? null,
      filename,
      created_at: d?.createdAt ?? null,
    };
  });
}

// Phases obligatoires manquantes (pour bloquer la validation de l'étape).
export async function missingRequiredCorrectionPhases(manuscriptId: string): Promise<string[]> {
  const state = await correctionCycleState(manuscriptId);
  return state.filter((p) => p.required && !p.has_file).map((p) => p.label);
}

// « À qui la main » : premier maillon du relais dont le fichier manque encore.
// Correcteur → Intégrateur → Correcteur → Intégrateur → terminé.
export async function currentCorrectionActor(manuscriptId: string): Promise<CorrectionActor | "termine"> {
  const state = await correctionCycleState(manuscriptId);
  for (const phase of CORRECTION_PHASES) {
    const s = state.find((x) => x.key === phase.key);
    if (!s?.has_file) return phase.actor;
  }
  return "termine";
}

// À qui passe la balle APRÈS le dépôt de `phaseKey` : l'acteur de la phase
// suivante, ou null si le cycle est terminé (dernière phase déposée).
export function nextActorAfterPhase(phaseKey: string): CorrectionActor | null {
  const idx = CORRECTION_PHASES.findIndex((p) => p.key === phaseKey);
  if (idx < 0 || idx + 1 >= CORRECTION_PHASES.length) return null;
  return CORRECTION_PHASES[idx + 1].actor;
}
