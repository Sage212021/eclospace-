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
// Les QUATRE phases sont obligatoires (demande opérateur 10/10 : « même la 3
// doit être obligatoire »). Le relais complet — 1re correction → version
// intégrée → 2e correction → version corrigée finale — est imposé, et l'étape
// Correction ne se valide qu'une fois les quatre déposées (en plus de la
// couverture corrigée finale).
export const CORRECTION_PHASES: (CorrectionPhase & { actor: CorrectionActor })[] = [
  { key: "rapport_1", label: "1re correction", required: true, actor: "correcteur" },
  { key: "integration_1", label: "Version intégrée", required: true, actor: "integrateur" },
  { key: "relecture_2", label: "2e correction (relecture)", required: true, actor: "correcteur" },
  { key: "integration_finale", label: "Version corrigée finale (VCF)", required: true, actor: "integrateur" },
];

// Rapports de correction de la COUVERTURE (branche infographe), en parallèle du
// texte : 1re relecture, retour intégration (BAT2), 2e relecture, couverture
// corrigée finale. Déposés par le correcteur et l'infographe (relais), routés à
// l'INFOGRAPHE (cf. « Mes intégrations de correction »). TOUTES OBLIGATOIRES
// (demande opérateur 10/10 : « rendre les étapes du cycle obligatoires aussi du
// côté couverture ») et déposées DANS L'ORDRE, comme le texte.
export const COVER_CORRECTION_PHASES: CorrectionPhase[] = [
  { key: "couverture_1", label: "Rapport de correction — couverture (1ʳᵉ · dos · 4ᵉ)", required: true },
  { key: "couverture_integration_1", label: "Retour intégration infographie (couverture BAT2)", required: true },
  { key: "couverture_2", label: "Rapport de correction — couverture (2ᵉ relecture)", required: true },
  { key: "couverture_finale", label: "Couverture corrigée finale", required: true },
];
// Phases de couverture DÉPOSÉES PAR L'INFOGRAPHE (retour vers le correcteur),
// par opposition aux rapports déposés par le correcteur.
const COVER_INTEGRATION_KEYS = new Set(["couverture_integration_1", "couverture_finale"]);
export function isCoverIntegrationDeposit(key: string): boolean {
  return COVER_INTEGRATION_KEYS.has(key);
}

const PHASE_KEYS = new Set(CORRECTION_PHASES.map((p) => p.key));
const COVER_PHASE_KEYS = new Set(COVER_CORRECTION_PHASES.map((p) => p.key));
export function isCorrectionPhase(key: string): boolean {
  return PHASE_KEYS.has(key) || COVER_PHASE_KEYS.has(key);
}
export function isCoverCorrectionPhase(key: string): boolean {
  return COVER_PHASE_KEYS.has(key);
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
async function cycleStateFor(manuscriptId: string, phases: CorrectionPhase[]) {
  const docs = await prisma.document.findMany({
    where: { entityType: "manuscript", entityId: manuscriptId, category: "piece_etape", deletedAt: null, title: { startsWith: PREFIX } },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, createdAt: true, createdBy: true, versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { id: true, fileSize: true, mimeType: true, versionNumber: true } } },
  });
  const latestByPhase = new Map<string, (typeof docs)[number]>();
  for (const d of docs) {
    const key = parseCorrectionPhaseKey(d.title);
    if (key && !latestByPhase.has(key)) latestByPhase.set(key, d);
  }
  return phases.map((p) => {
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
      version_number: v?.versionNumber ?? null,
      filename,
      created_at: d?.createdAt ?? null,
    };
  });
}

export function correctionCycleState(manuscriptId: string) {
  return cycleStateFor(manuscriptId, CORRECTION_PHASES);
}
// État des rapports de correction de COUVERTURE (branche infographe).
export function coverCorrectionCycleState(manuscriptId: string) {
  return cycleStateFor(manuscriptId, COVER_CORRECTION_PHASES);
}

// Phases obligatoires manquantes (pour bloquer la validation de l'étape).
export async function missingRequiredCorrectionPhases(manuscriptId: string): Promise<string[]> {
  const state = await correctionCycleState(manuscriptId);
  return state.filter((p) => p.required && !p.has_file).map((p) => p.label);
}

// Clôture de l'étape Correction (demande opérateur 26/09/2026) : la COUVERTURE
// corrigée finale (1ʳᵉ, dos, 4ᵉ) doit être déposée, en plus du texte, pour que
// l'ouvrage parte en mise en page. Vrai tant que ce fichier manque.
export async function coverFinaleMissing(manuscriptId: string): Promise<boolean> {
  const state = await coverCorrectionCycleState(manuscriptId);
  return !state.find((p) => p.key === "couverture_finale")?.has_file;
}

// Phases de COUVERTURE obligatoires manquantes (demande opérateur 10/10 : le
// cycle couverture est désormais obligatoire, au même titre que le texte).
export async function missingRequiredCoverPhases(manuscriptId: string): Promise<string[]> {
  const state = await coverCorrectionCycleState(manuscriptId);
  return state.filter((p) => p.required && !p.has_file).map((p) => p.label);
}

// Le correcteur a-t-il réellement TRANSMIS un rapport de correction de couverture
// (fichier déposé, pas une simple fiche vide) ? Sert à n'afficher l'intégration de
// couverture à l'infographe que lorsqu'il y a vraiment quelque chose à intégrer
// (demande opérateur 02/10).
export async function coverReportReceived(manuscriptId: string): Promise<boolean> {
  const state = await coverCorrectionCycleState(manuscriptId);
  return state.some((p) => (p.key === "couverture_1" || p.key === "couverture_2") && p.has_file);
}

// Le correcteur a-t-il réellement TRANSMIS un rapport de correction du TEXTE
// (fichier déposé : 1re correction ou 2e relecture) ? Symétrique de
// coverReportReceived, pour n'afficher l'intégration éditoriale que lorsqu'il y a
// vraiment de la matière à intégrer (demande opérateur 03/10).
export async function textReportReceived(manuscriptId: string): Promise<boolean> {
  const state = await correctionCycleState(manuscriptId);
  return state.some((p) => (p.key === "rapport_1" || p.key === "relecture_2") && p.has_file);
}

// AVANCEMENT RÉEL d'un lot de manuscrits, calculé sur les phases du circuit
// (fichiers réellement déposés), en UNE seule requête. Base du pourcentage par
// manuscrit du pôle Correction éditoriale : le travail n'est PAS suivi par des
// « tâches » mais par ces 8 livrables (texte : 4 ; couverture : 4).
const TEXT_PHASE_KEYS = CORRECTION_PHASES.map((p) => p.key);
const COVER_PHASE_KEYS_ORDERED = COVER_CORRECTION_PHASES.map((p) => p.key);

export interface CorrectionProgress {
  textPhases: string[];       // clés de phases TEXTE réellement déposées
  coverPhases: string[];      // clés de phases COUVERTURE réellement déposées
  textDone: number;           // 0..4
  coverDone: number;          // 0..4
  phasesDone: number;         // 0..8
  phasesTotal: number;        // 8
  pct: number;                // 0..100 (phasesDone / 8)
  nextTextActor: CorrectionActor | "termine";   // à qui la main sur le texte
  started: boolean;           // au moins une phase déposée
  inSecondCorrection: boolean; // 1re correction + version intégrée faites, 2e en jeu
}

function emptyProgress(): CorrectionProgress {
  return { textPhases: [], coverPhases: [], textDone: 0, coverDone: 0, phasesDone: 0, phasesTotal: 8, pct: 0, nextTextActor: "correcteur", started: false, inSecondCorrection: false };
}

export async function correctionProgressBatch(manuscriptIds: string[]): Promise<Map<string, CorrectionProgress>> {
  const result = new Map<string, CorrectionProgress>();
  if (manuscriptIds.length === 0) return result;
  const docs = await prisma.document.findMany({
    where: { entityType: "manuscript", entityId: { in: manuscriptIds }, category: "piece_etape", deletedAt: null, title: { startsWith: PREFIX } },
    select: { entityId: true, title: true, versions: { take: 1, select: { id: true } } },
  });
  // Clés de phase réellement présentes (un fichier déposé) par manuscrit.
  const present = new Map<string, Set<string>>();
  for (const d of docs) {
    if (!d.versions.length) continue; // pas de fichier = phase non déposée
    const key = parseCorrectionPhaseKey(d.title);
    if (!key) continue;
    let set = present.get(d.entityId);
    if (!set) { set = new Set(); present.set(d.entityId, set); }
    set.add(key);
  }
  for (const id of manuscriptIds) {
    const set = present.get(id);
    if (!set) { result.set(id, emptyProgress()); continue; }
    const textPhases = TEXT_PHASE_KEYS.filter((k) => set.has(k));
    const coverPhases = COVER_PHASE_KEYS_ORDERED.filter((k) => set.has(k));
    const phasesDone = textPhases.length + coverPhases.length;
    // À qui la main sur le texte : 1re phase texte dont le fichier manque.
    let nextTextActor: CorrectionActor | "termine" = "termine";
    for (const phase of CORRECTION_PHASES) {
      if (!set.has(phase.key)) { nextTextActor = phase.actor; break; }
    }
    const inSecondCorrection = set.has("rapport_1") && set.has("integration_1") && !set.has("integration_finale");
    result.set(id, {
      textPhases,
      coverPhases,
      textDone: textPhases.length,
      coverDone: coverPhases.length,
      phasesDone,
      phasesTotal: 8,
      pct: Math.round((phasesDone / 8) * 100),
      nextTextActor,
      started: phasesDone > 0,
      inSecondCorrection,
    });
  }
  return result;
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
