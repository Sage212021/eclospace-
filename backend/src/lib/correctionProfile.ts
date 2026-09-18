import { prisma } from "./prisma.js";

// Moteur de « Assistance de correction éditoriale IA — Éditions Éclosion ».
// Ce module porte le PARAMÉTRAGE éditable (types d'ouvrage, supports) et la
// MÉTHODE (grilles de contrôle par type, sévérités C1/C2/C3/S, règles de
// fiabilité) injectée dans les prompts de correction. Le moteur reste générique :
// ajouter un type d'ouvrage = ajouter une ligne + son profil, sans le modifier.

export type Severity = "C1" | "C2" | "C3" | "S";

// Supports analysés (liste stable ; le contrôle s'adapte au support). Le code
// sert de clé ; le libellé s'affiche. Modifiable ici sans migration.
export const SUPPORTS: { code: string; label: string }[] = [
  { code: "manuscrit_interieur", label: "Manuscrit intérieur" },
  { code: "premier_bat", label: "Premier BAT" },
  { code: "couverture", label: "Couverture / jaquette" },
  { code: "livre_illustre", label: "Livre illustré" },
  { code: "livre_enfant", label: "Livre enfant" },
  { code: "version_corrigee", label: "Version corrigée après première relecture" },
  { code: "deuxieme_bat", label: "Deuxième BAT" },
  { code: "autre", label: "Autre support" },
];
export function isSupport(code: string): boolean {
  return SUPPORTS.some((s) => s.code === code);
}
export function supportLabel(code: string | null | undefined): string {
  return SUPPORTS.find((s) => s.code === code)?.label ?? "Manuscrit intérieur";
}

// Types d'ouvrage par défaut (les 23 du cahier). Amorce du paramétrage : ils sont
// ensuite ÉDITABLES en base (ajout/retrait/renommage) sans toucher au moteur.
export const DEFAULT_BOOK_TYPES: { code: string; label: string }[] = [
  { code: "roman", label: "Roman" },
  { code: "nouvelle", label: "Nouvelle" },
  { code: "theatre", label: "Théâtre" },
  { code: "poesie", label: "Poésie" },
  { code: "essai", label: "Essai" },
  { code: "scientifique", label: "Ouvrage scientifique" },
  { code: "universitaire", label: "Ouvrage universitaire" },
  { code: "politique", label: "Ouvrage politique" },
  { code: "histoire", label: "Ouvrage historique" },
  { code: "biographie", label: "Biographie" },
  { code: "autobiographie", label: "Autobiographie" },
  { code: "jeunesse", label: "Livre jeunesse" },
  { code: "enfant", label: "Livre enfant" },
  { code: "album", label: "Album illustré" },
  { code: "documentaire", label: "Documentaire" },
  { code: "manuel", label: "Manuel pédagogique" },
  { code: "professionnel", label: "Ouvrage professionnel" },
  { code: "gestion_eco", label: "Gestion / économie" },
  { code: "droit", label: "Droit" },
  { code: "dev_perso", label: "Développement personnel" },
  { code: "bande_dessinee", label: "Bande dessinée" },
  { code: "catalogue", label: "Catalogue / ouvrage documentaire" },
  { code: "autre", label: "Autre" },
];

// Grilles de contrôle par type (points de contrôle + sévérité indicative). Base
// amorçée en seed, puis éditable. Le profil « __defaut__ » s'applique à tout type
// sans grille propre.
type Pt = [string, Severity];
const COMMON: Pt[] = [
  ["Orthographe, accents et majuscules", "C2"],
  ["Grammaire, accords et conjugaison", "C2"],
  ["Syntaxe et ponctuation", "C3"],
  ["Typographie, espaces, guillemets et apostrophes", "C3"],
  ["Cohérence terminologique et des noms propres", "C1"],
  ["Cohérence des dates et des chiffres", "C1"],
  ["Cohérence entre les différentes parties", "C2"],
  ["Structure, pagination et table des matières", "C2"],
  ["Numérotation et paratexte", "C3"],
  ["Cohérence couverture / intérieur", "C1"],
  ["Notes internes ou commentaires résiduels à retirer", "C1"],
  ["Lisibilité et adéquation au public cible", "C3"],
];
export const DEFAULT_PROFILES: { code: string; label: string; points: Pt[] }[] = [
  { code: "__defaut__", label: "Profil de correction par défaut", points: COMMON },
  { code: "roman", label: "Roman / Nouvelle", points: [...COMMON, ["Cohérence des personnages (noms, prénoms)", "C1"], ["Temporalité, chronologie et lieux", "C1"], ["Concordance des temps et voix narrative", "C2"], ["Dialogues et ponctuation des dialogues", "C2"], ["Répétitions involontaires", "C3"], ["Continuité des scènes et cohérence narrative", "C2"], ["Ne pas normaliser abusivement le style littéraire", "S"]] },
  { code: "nouvelle", label: "Nouvelle", points: [...COMMON, ["Cohérence des personnages (noms, prénoms)", "C1"], ["Temporalité, chronologie et lieux", "C1"], ["Concordance des temps et voix narrative", "C2"], ["Dialogues et ponctuation des dialogues", "C2"], ["Répétitions involontaires", "C3"], ["Continuité des scènes et cohérence narrative", "C2"], ["Ne pas normaliser abusivement le style littéraire", "S"]] },
  { code: "theatre", label: "Théâtre", points: [...COMMON, ["Noms des personnages", "C1"], ["Dialogues et présentation des répliques", "C2"], ["Didascalies et indications scéniques", "C2"], ["Actes, scènes, entrées et sorties", "C1"], ["Continuité dramatique", "C3"]] },
  { code: "poesie", label: "Poésie", points: [["Orthographe", "C2"], ["Grammaire lorsque applicable", "C3"], ["Ponctuation et cohérence typographique", "C3"], ["Disposition des vers et strophes", "C3"], ["Répétitions et cohérence graphique", "S"], ["Titre des poèmes et pagination", "C3"], ["Rupture volontaire (syntaxe, ponctuation, majuscule, rythme) → SUGGESTION, jamais erreur", "S"]] },
  { code: "essai", label: "Essai", points: [...COMMON, ["Cohérence de la problématique et progression des idées", "C2"], ["Cohérence argumentative, concepts et définitions", "C2"], ["Transitions et cohérence des conclusions", "C3"], ["Références, citations et notes", "C1"], ["Répétitions", "C3"]] },
  { code: "politique", label: "Ouvrage politique", points: [...COMMON, ["Noms des personnalités, fonctions et institutions", "C1"], ["Dates, événements et lieux", "C1"], ["Données chiffrées", "C1"], ["Citations et références", "C1"], ["Chronologie et cohérence affirmations/sources", "C2"], ["Élément à vérifier si non établissable depuis le document — ne jamais inventer une source", "C1"]] },
  { code: "scientifique", label: "Ouvrage scientifique", points: [...COMMON, ["Terminologie scientifique, concepts et unités", "C1"], ["Données, chiffres, tableaux et figures (+ légendes)", "C1"], ["Cohérence texte / tableaux / figures", "C1"], ["Références, citations, bibliographie", "C1"], ["Équations / formules lorsque lisibles", "C2"], ["Abréviations et symboles", "C3"], ["Distinguer erreur certaine / à vérifier par un expert — ne pas présenter une hypothèse comme un fait", "C1"]] },
  { code: "universitaire", label: "Ouvrage universitaire", points: [...COMMON, ["Problématique, structure et hiérarchisation", "C2"], ["Chapitres, sous-chapitres et titres", "C2"], ["Citations, notes et appels de références", "C1"], ["Bibliographie et cohérence des références", "C1"], ["Tableaux et figures", "C2"]] },
  { code: "histoire", label: "Ouvrage historique", points: [...COMMON, ["Chronologie, dates et périodes", "C1"], ["Noms, lieux et événements", "C1"], ["Titres et fonctions historiques", "C2"], ["Cohérence temporelle", "C1"], ["Références historiques lorsque présentes", "C2"]] },
  { code: "biographie", label: "Biographie / Autobiographie", points: [...COMMON, ["Noms, dates et lieux", "C1"], ["Chronologie et événements", "C1"], ["Personnes citées et fonctions", "C2"], ["Cohérence du récit et contradictions internes", "C2"], ["Répétitions", "C3"]] },
  { code: "autobiographie", label: "Autobiographie", points: [...COMMON, ["Noms, dates et lieux", "C1"], ["Chronologie et événements", "C1"], ["Personnes citées et fonctions", "C2"], ["Cohérence du récit et contradictions internes", "C2"], ["Répétitions", "C3"]] },
  { code: "jeunesse", label: "Livre jeunesse", points: [...COMMON, ["Niveau de langue et âge cible", "C2"], ["Vocabulaire et longueur des phrases", "C3"], ["Compréhension et lisibilité", "C2"], ["Cohérence pédagogique", "C2"], ["Cohérence texte / image", "C1"], ["Consignes et gabarits récurrents", "C3"]] },
  { code: "enfant", label: "Livre enfant / Album illustré", points: [["Orthographe et grammaire", "C2"], ["Simplicité du langage et âge cible", "C2"], ["Longueur du texte et rythme", "C3"], ["Répétitions utiles", "S"], ["Cohérence texte / image", "C1"], ["Continuité narrative, pagination et ordre des pages", "C1"], ["Personnages et illustrations", "C2"], ["Consignes et cohérence des gabarits", "C3"]] },
  { code: "album", label: "Album illustré", points: [["Orthographe et grammaire", "C2"], ["Simplicité du langage et âge cible", "C2"], ["Longueur du texte et rythme", "C3"], ["Cohérence texte / image", "C1"], ["Continuité narrative, pagination et ordre des pages", "C1"], ["Personnages et illustrations", "C2"], ["Cohérence des gabarits", "C3"]] },
  { code: "manuel", label: "Manuel pédagogique", points: [...COMMON, ["Objectifs et progression", "C2"], ["Consignes, exercices et exemples", "C2"], ["Corrigés et cohérence exercice / réponse", "C1"], ["Illustrations, tableaux et numérotation", "C2"], ["Vocabulaire pédagogique", "C3"]] },
  { code: "professionnel", label: "Ouvrage professionnel / Gestion / Économie", points: [...COMMON, ["Terminologie professionnelle et définitions", "C2"], ["Chiffres, tableaux et calculs / formules fournis", "C1"], ["Exemples et cohérence des données", "C2"], ["Graphiques et références", "C2"], ["Cohérence des conclusions avec les données", "C1"]] },
  { code: "gestion_eco", label: "Gestion / économie", points: [...COMMON, ["Terminologie professionnelle et définitions", "C2"], ["Chiffres, tableaux et calculs / formules fournis", "C1"], ["Exemples et cohérence des données", "C2"], ["Graphiques et références", "C2"], ["Cohérence des conclusions avec les données", "C1"]] },
  { code: "droit", label: "Droit", points: [...COMMON, ["Terminologie juridique", "C2"], ["Articles, textes cités et juridictions", "C1"], ["Références et cohérence des références", "C1"], ["Dates et numérotation", "C2"], ["Vérification juridique nécessitant une source externe → explicitement identifiée", "C1"]] },
  { code: "dev_perso", label: "Développement personnel", points: [...COMMON, ["Cohérence des concepts et progression", "C3"], ["Exercices, consignes et exemples", "C3"], ["Répétitions", "C3"], ["Lisibilité et registre de langue", "C3"]] },
  { code: "bande_dessinee", label: "Bande dessinée", points: [["Orthographe et ponctuation", "C2"], ["Dialogues, bulles et cartouches", "C2"], ["Personnages, noms et lieux", "C1"], ["Continuité narrative et séquençage", "C2"], ["Cohérence texte / image", "C1"]] },
];

// Grille de contrôle EFFECTIVE d'un type : ses points actifs, sinon le profil par
// défaut. Un type sans grille propre hérite ainsi de la grille commune.
export async function effectiveControlPoints(bookTypeCode: string | null | undefined) {
  const order = [{ displayOrder: "asc" as const }, { label: "asc" as const }];
  if (bookTypeCode) {
    const own = await prisma.correctionProfile.findFirst({ where: { bookTypeCode, isActive: true }, select: { controlPoints: { where: { isActive: true }, orderBy: order } } });
    if (own && own.controlPoints.length) return own.controlPoints;
  }
  const def = await prisma.correctionProfile.findFirst({ where: { bookTypeCode: "__defaut__", isActive: true }, select: { controlPoints: { where: { isActive: true }, orderBy: order } } });
  return def?.controlPoints ?? [];
}

export const SEVERITY_GUIDE =
  "Sévérités à utiliser STRICTEMENT : C1 (BLOQUANT — à corriger avant validation du BAT) ; C2 (IMPORTANT — à corriger avant impression) ; C3 (MINEUR — correction souhaitable, non bloquante) ; S (SUGGESTION — style, harmonisation, amélioration). Une SUGGESTION n'est JAMAIS présentée comme une erreur certaine.";

// Règles de fiabilité (§16 du cahier) — condensées, imposées à chaque relecture.
export const RELIABILITY_RULES =
  "Règles de fiabilité impératives : (1) ne jamais inventer une information ; (2) ni une référence bibliographique ; (3) ne jamais présenter une vérification non effectuée comme effectuée ; (4) distinguer explicitement « erreur certaine » et « point à vérifier » ; (5) respecter le style volontaire de l'auteur ; (6) ne pas réécrire un texte simplement parce qu'une autre formulation semble meilleure ; (7) préserver les choix littéraires cohérents ; (8) signaler les incertitudes ; (9) donner des corrections localisées et exploitables (où → quoi → correction → pourquoi si nécessaire) ; (10) en 2e relecture, vérifier explicitement les corrections de la 1re relecture.";

// Bloc « méthode » injecté dans le prompt de correction, construit à partir des
// paramètres choisis (type d'ouvrage, support, n° de relecture) et de la grille
// éditable. C'est le cœur du moteur : la grille se charge automatiquement.
export async function buildCorrectionMethodText(opts: { bookTypeCode?: string | null; bookTypeLabel?: string | null; support?: string | null; relecture: 1 | 2 }): Promise<string> {
  const points = await effectiveControlPoints(opts.bookTypeCode);
  const grille = points.length
    ? points.map((p) => `- ${p.label} [${p.defaultSeverity}]`).join("\n")
    : "- (grille non configurée — applique une correction éditoriale générale)";
  const typeLabel = opts.bookTypeLabel || "(non précisé)";
  const support = supportLabel(opts.support);
  return [
    "=== ASSISTANCE DE CORRECTION ÉDITORIALE — ÉDITIONS ÉCLOSION ===",
    `Paramètres : Type d'ouvrage = ${typeLabel} · Support analysé = ${support} · Passage = Relecture ${opts.relecture}.`,
    "",
    "Grille de contrôle à appliquer pour ce type d'ouvrage (chaque point = à vérifier ; la sévérité entre crochets est indicative, ajuste-la au cas réel) :",
    grille,
    "",
    SEVERITY_GUIDE,
    "",
    RELIABILITY_RULES,
  ].join("\n");
}
