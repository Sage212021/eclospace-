import type Anthropic from "@anthropic-ai/sdk";
import { withThinking } from "./aiThinking.js";

// Budget de « réflexion approfondie » par segment (jetons de raisonnement) quand
// le modèle la gère (Sonnet/Opus). Le relecteur réfléchit avant de lister les
// anomalies du segment — meilleure détection des coquilles fines.
const SWEEP_THINK_BUDGET = 8000;

// ─────────────────────────────────────────────────────────────────────────
// Lecture INTÉGRALE par segments (renforcement BAT1/BAT2, demande opérateur).
// Le défaut historique : pour un manuscrit volumineux, le moteur n'analysait
// qu'un « extrait représentatif » (début/milieu/fin) en un seul appel — il
// passait donc à côté des erreurs des passages non lus. Ici, on découpe le
// manuscrit en segments ORDONNÉS couvrant TOUT le texte, on relève les
// anomalies segment par segment, et on consolide — avec une couverture vérifiée
// (N/N segments). Le relevé alimente ensuite le rapport structuré.
// ─────────────────────────────────────────────────────────────────────────

// Taille d'un bloc de lecture (révisée le 16/11/2026, demande opérateur).
// AVANT : blocs très courts (~7 pages) « pour forcer une lecture fine ». À l'usage,
// le résultat était MOINS bon que la lecture en conversation (claude.ai), parce
// que des blocs isolés font PERDRE LA VUE D'ENSEMBLE (cohérence des noms, du ton,
// des renvois) et morcellent le raisonnement. On lit désormais en GROS BLOCS
// COHÉRENTS : la plupart des ouvrages tiennent en UN SEUL bloc (lecture d'un seul
// tenant, comme en conversation) ; seuls les manuscrits très volumineux sont
// couverts en 2-3 grands blocs — jamais en dizaines de tranches. Chaque bloc
// bénéficie d'un budget de réflexion approfondie élargi (SWEEP_THINK_BUDGET).
// Valeur ajustable dans docs/JOURNAL_TECHNIQUE.md.
export const SEGMENT_CHARS = 120_000;

// ─────────────────────────────────────────────────────────────────────────
// DÉCOUPAGE PROPRE (correctif « scandale BAT2 », demande opérateur 15/11/2026).
// Ancien défaut : le texte n'était coupé que sur « \n\n » alors que l'extraction
// (.docx/.odt/.pdf) ne produit qu'un SEUL « \n » entre paragraphes → les
// frontières de paragraphe étaient invisibles, et un bloc trop long était
// TRANCHÉ EN PLEIN MOT / EN PLEINE PHRASE. Conséquence : le relecteur voyait de
// fausses « phrases inachevées » (la phrase continuait en réalité dans le
// segment suivant) et, sans repère de chapitre, INVENTAIT un numéro de chapitre
// (« chapitre 12 » pour une phrase du chapitre 11).
//
// Correctif : (1) couper UNIQUEMENT sur de vraies frontières — paragraphe, puis
// phrase, puis mot — jamais au milieu d'un mot ; (2) détecter les titres de
// chapitre et ne JAMAIS faire chevaucher deux chapitres dans un même segment ;
// (3) étiqueter chaque segment avec son chapitre réel + un drapeau « la suite du
// chapitre continue » pour que le relecteur ne crie pas à la « phrase inachevée »
// sur une simple coupe technique.
// ─────────────────────────────────────────────────────────────────────────

// Coupe un bloc de texte en portions ≤ maxChars sur des frontières PROPRES :
// d'abord sur les sauts de ligne (paragraphes), puis, pour une ligne trop
// longue, sur les fins de phrase (. ! ? …), puis en dernier recours sur les
// espaces (jamais au milieu d'un mot). Conserve tout le texte dans l'ordre.
function splitClean(block: string, maxChars: number): string[] {
  const t = block.trim();
  if (!t) return [];
  if (t.length <= maxChars) return [t];

  // Unités atomiques insécables : une ligne, sinon une phrase, sinon un mot.
  const atoms: string[] = [];
  for (const line of t.split(/\n/)) {
    if (line.length <= maxChars) { atoms.push(line); continue; }
    // Ligne trop longue → phrases (on garde la ponctuation finale).
    for (const sentence of line.split(/(?<=[.!?…»])\s+/)) {
      if (sentence.length <= maxChars) { atoms.push(sentence); continue; }
      // Phrase trop longue → mots (jamais au milieu d'un mot).
      let word = "";
      for (const w of sentence.split(/(\s+)/)) {
        if ((word + w).length > maxChars) {
          if (word.trim()) atoms.push(word.trim());
          // Mot unique démesuré (URL, suite sans espace) : dernier recours,
          // tranche nette — cas pathologique, jamais une vraie phrase.
          if (w.length > maxChars) { for (let i = 0; i < w.length; i += maxChars) atoms.push(w.slice(i, i + maxChars)); word = ""; }
          else word = w;
        } else word += w;
      }
      if (word.trim()) atoms.push(word.trim());
    }
  }

  // Regroupe les unités en portions ≤ maxChars (recollées par saut de ligne).
  const parts: string[] = [];
  let buf = "";
  for (const a of atoms) {
    const add = buf ? `\n${a}` : a;
    if (buf && buf.length + add.length > maxChars) { parts.push(buf); buf = a; }
    else buf += add;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

// Découpe le texte en segments d'environ maxChars, sur des frontières PROPRES
// (paragraphe → phrase → mot, jamais en plein mot). Conserve TOUT le texte,
// dans l'ordre. Conservé pour les contrôles de fiabilité ; la lecture éditoriale
// utilise segmentForReview (consciente des chapitres).
export function segmentText(text: string, maxChars: number): string[] {
  const t = (text ?? "").trim();
  if (!t) return [];
  if (t.length <= maxChars) return [t];
  return splitClean(t, maxChars);
}

// Un segment de lecture ÉTIQUETÉ : son chapitre réel + un drapeau de continuité.
export interface ReviewSegment {
  label: string; // ex. « Chapitre 11 » ou « Chapitre 11 (partie 2/3) »
  chapter: string; // ex. « Chapitre 11 » (sans la mention de partie) — pour la localisation
  text: string;
  continues: boolean; // true si la suite du MÊME chapitre arrive au segment suivant
}

// Reconnaît un titre de chapitre/section en DÉBUT de ligne. Volontairement
// prudent : « Chapitre » / « Chapter » / « Chap. » suivi d'un numéro (chiffres,
// romain ou ordinal), ou une section liminaire nommée (Prologue, Épilogue…).
const CHAPTER_RE =
  /^\s*(chapitre|chapter|chap\.)\s+([0-9]{1,3}|[ivxlcdm]{1,8}|premier|première|premiere|deuxième|deuxieme|second[e]?|troisième|troisieme|quatrième|quatrieme|cinquième|cinquieme|sixième|sixieme|septième|septieme|huitième|huitieme|neuvième|neuvieme|dixième|dixieme)\b/i;
const SECTION_RE = /^\s*(prologue|épilogue|epilogue|avant[- ]propos|avant[- ]?propos|préface|preface|introduction|conclusion|postface|liminaire|ouverture|exergue|remerciements|dédicace|dedicace)\b/i;

function isHeading(line: string): boolean {
  const l = line.trim();
  if (!l || l.length > 90) return false; // un titre reste court
  return CHAPTER_RE.test(l) || SECTION_RE.test(l);
}

// Normalise un titre en libellé court et propre (sert à citer le BON chapitre).
function headingLabel(line: string): string {
  return line.trim().replace(/\s+/g, " ").slice(0, 70);
}

// Libellé de couverture d'un bloc : un seul chapitre, ou une plage « X … Y ».
function rangeLabel(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "Ouverture";
  return `${labels[0]} … ${labels[labels.length - 1]}`;
}

// Découpe le texte en GROS BLOCS COHÉRENTS étiquetés, conscients des chapitres
// (révisé 16/11/2026 — lecture en gros blocs, cf. SEGMENT_CHARS) :
//  1. on repère les titres de chapitre/section (en début de ligne) ;
//  2. on REGROUPE plusieurs chapitres consécutifs dans un même bloc tant qu'on
//     reste sous maxChars (la plupart des ouvrages → UN SEUL bloc = lecture d'un
//     seul tenant) ; les coupes tombent sur des frontières de chapitre ;
//  3. un chapitre plus long que maxChars est découpé en portions PROPRES
//     (paragraphe → phrase → mot) étiquetées « (partie k/m) » ;
//  4. chaque bloc porte le libellé des chapitres couverts + un drapeau de
//     continuité (pour un chapitre coupé). Les TITRES DE CHAPITRE restent dans le
//     texte du bloc : le relecteur localise chaque anomalie d'après le titre qui
//     la précède — il n'invente donc jamais un numéro de chapitre.
export function segmentForReview(text: string, maxChars: number): ReviewSegment[] {
  const t = (text ?? "").trim();
  if (!t) return [];

  // 1) Regroupe les lignes en BLOCS de chapitre (titre + corps jusqu'au titre suivant).
  const lines = t.split(/\n/);
  const blocks: { label: string; body: string }[] = [];
  let curLabel = "Ouverture"; // texte avant le 1ᵉʳ titre (page de titre, exergue…)
  let curLines: string[] = [];
  const pushBlock = () => {
    const body = curLines.join("\n").trim();
    if (body) blocks.push({ label: curLabel, body });
    curLines = [];
  };
  for (const line of lines) {
    if (isHeading(line)) { pushBlock(); curLabel = headingLabel(line); }
    curLines.push(line);
  }
  pushBlock();
  if (!blocks.length) blocks.push({ label: "Ouverture", body: t });

  // 2+3) On EMPILE les chapitres consécutifs en gros blocs ≤ maxChars ; un
  // chapitre trop long à lui seul est découpé en portions propres.
  const segs: ReviewSegment[] = [];
  let buf = "";
  let bufLabels: string[] = [];
  const flushBuf = () => {
    if (buf.trim()) segs.push({ label: rangeLabel(bufLabels), chapter: rangeLabel(bufLabels), text: buf.trim(), continues: false });
    buf = "";
    bufLabels = [];
  };
  for (const b of blocks) {
    if (b.body.length > maxChars) {
      // Chapitre plus long que maxChars : on vide l'empilement courant, puis on
      // le découpe en portions propres étiquetées (partie k/m), avec continuité.
      flushBuf();
      const parts = splitClean(b.body, maxChars);
      parts.forEach((part, k) => {
        segs.push({
          label: parts.length > 1 ? `${b.label} (partie ${k + 1}/${parts.length})` : b.label,
          chapter: b.label,
          text: part,
          continues: k < parts.length - 1,
        });
      });
      continue;
    }
    // Ajouter ce chapitre ferait-il déborder le bloc courant ? Si oui, on flush.
    if (buf && buf.length + 2 + b.body.length > maxChars) flushBuf();
    buf = buf ? `${buf}\n\n${b.body}` : b.body;
    bufLabels.push(b.label);
  }
  flushBuf();
  return segs;
}

export interface SweepResult {
  releve: string;
  coveredSegments: number;
  totalSegments: number;
  inputTokens: number;
  outputTokens: number;
}

// Relève TOUTES les anomalies du manuscrit, segment par segment (lecture
// intégrale). Ne lève pas sur une erreur de segment isolée (le segment est noté
// comme non analysé) ; relaie en revanche une annulation via beforeEach.
export async function runAnomalySweep(opts: {
  client: Anthropic;
  model: string;
  segments: ReviewSegment[];
  passLabel: string; // ex. « BAT1 (première relecture) »
  methodBlock: string; // grille + guide de sévérité + règles de fiabilité
  maxTokens?: number;
  onProgress?: (done: number, total: number) => Promise<void> | void;
  beforeEach?: () => Promise<void>; // throwIfCancelled
}): Promise<SweepResult> {
  const total = opts.segments.length;
  const system =
    `Tu es le relecteur éditorial ${opts.passLabel} des Éditions Éclosion, lecteur professionnel expérimenté et exigeant. ` +
    "On te donne UN SEGMENT d'un manuscrit. Tu le lis INTÉGRALEMENT, MOT À MOT (jamais en diagonale, jamais un échantillon), comme un correcteur professionnel qui passe sur chaque mot, et tu relèves TOUTES ses anomalies, sans en inventer aucune. " +
    "Anomalies visées : coquilles, fautes d'orthographe, d'accord (participe passé, adjectif, pluriel), de grammaire et de conjugaison, erreurs de syntaxe, de ponctuation, de typographie et d'ACCENTS (ex. « ô » vs « oh »), mots manquants ou en trop, répétitions injustifiées, incohérences (noms propres, dates, chiffres, titres, références), formulations ambiguës. " +
    "VIGILANCE NOMS PROPRES ET CITATIONS (impérative) : chaque nom d'auteur, de personnalité, d'œuvre, de lieu, de marque ou d'institution doit être vérifié lettre par lettre. Si une graphie te paraît inhabituelle, douteuse ou fautive, tu la SIGNALES — même si tu « sais » la forme correcte : ne corrige JAMAIS un nom propre en silence dans ta tête. En cas de doute, propose la forme correcte attendue et marque « (à vérifier) ». Exemples typiques déjà vus et passés à tort : « Paolo Coehlo » au lieu de « Paulo Coelho » ; un prénom erroné devant un nom célèbre ; un titre d'ouvrage mal orthographié. " +
    "Tu relèves AUSSI les coquilles qui paraissent mineures (une lettre en trop/en moins, un accent, un accord) : ce sont précisément celles qui passent inaperçues et qu'un lecteur humain voit. " +
    "Tu distingues l'ERREUR CERTAINE de la simple SUGGESTION de style : une préférence stylistique n'est jamais présentée comme une faute. " +
    "Tu ne réduis pas artificiellement le nombre d'anomalies : il correspond à ce que CE segment contient réellement. " +
    "Tu ne mentionnes JAMAIS une limite de lecture, d'extraction ou de traitement du fichier, et tu ne déclares pas le segment « coupé » ou « incomplet » pour une raison technique. Tu ne signales une rupture réelle (phrase inachevée, passage manifestement manquant) QUE si tu peux CITER le passage exact concerné de CE segment. " +
    "INTERDICTION ABSOLUE (artefacts d'extraction, jamais des fautes de l'auteur) : tu ne signales JAMAIS un « mot coupé », une « coupure de mot injustifiée », une « césure » (ex. « his- toire », « négocia- tions ») ni des « éléments parasitaires » du type numéros isolés ou appels de note (ex. « 1 », « 2 ») — ce sont des résidus de mise en page ou de lecture du fichier, pas des erreurs du texte. Tu les IGNORES purement et simplement. " +
    "LOCALISATION (OBLIGATOIRE) : pour CHAQUE anomalie, tu cites la PHRASE ENTIÈRE qui la contient (mot à mot), et non le seul mot, et tu indiques sa localisation (chapitre + numéro de page s'il est visible) — pour que l'intégrateur la retrouve sans effort. " +
    "Tu n'écris NI préambule NI conclusion : seulement la liste.\n\n" +
    opts.methodBlock;

  let releve = "";
  let covered = 0;
  let inTok = 0;
  let outTok = 0;
  for (let i = 0; i < total; i++) {
    if (opts.beforeEach) await opts.beforeEach();
    const seg = opts.segments[i];
    // Repère de chapitre RÉEL : le relecteur localise l'anomalie dans CE chapitre,
    // il n'invente JAMAIS un autre numéro (correctif « chapitre 12 » pour une
    // phrase du chapitre 11).
    const continuationNote = seg.continues
      ? `\n\n⚠ Ce segment est une PORTION du « ${seg.chapter} » : le texte se POURSUIT dans le segment suivant. ` +
        "Ne signale donc NI « phrase inachevée » NI « chapitre incomplet » à la toute fin de ce segment : c'est une coupe technique de lecture, PAS une anomalie du texte. Analyse uniquement ce qui est présent ici."
      : "";
    const user =
      `=== BLOC ${i + 1}/${total} — ${seg.label} (à lire INTÉGRALEMENT) ===\n` +
      `Ce bloc couvre : ${seg.chapter}. Les TITRES DE CHAPITRE figurent dans le texte ci-dessous : localise CHAQUE anomalie d'après le titre de chapitre qui la PRÉCÈDE dans le texte ; n'invente jamais un numéro de chapitre.` +
      continuationNote +
      `\n\n${seg.text}\n\n` +
      "=== CONSIGNE ===\n" +
      "Relève TOUTES les anomalies de CE bloc, une par ligne, au format :\n" +
      "- [catégorie · sévérité C1/C2/C3/S] « PHRASE ENTIÈRE contenant l'anomalie, citée mot à mot » → correction proposée | Localisation : chapitre (d'après le titre qui précède) + n° de page s'il est visible\n" +
      "RÈGLE DE LOCALISATION (OBLIGATOIRE, pour faciliter l'intégration) : tu cites la PHRASE COMPLÈTE où se trouve le mot fautif (pas seulement le mot isolé), afin que l'intégrateur la retrouve immédiatement ; tu indiques la localisation (chapitre, et le numéro de page s'il apparaît dans le texte de ce segment).\n" +
      "Tu ne signales JAMAIS une « coupure de mot » ou un « mot coupé » : un mot coupé en fin de ligne (césure) n'est PAS une faute de l'auteur.\n" +
      `Si le segment ne contient aucune anomalie, écris exactement : « Segment ${i + 1} : RAS ».`;
    // Jusqu'à 2 tentatives : un incident ponctuel sur un segment ne doit pas
    // laisser un trou de couverture ni une mention technique dans le relevé.
    let done = false;
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      try {
        const resp = await opts.client.messages.create({ model: opts.model, ...withThinking(opts.model, opts.maxTokens ?? 8000, SWEEP_THINK_BUDGET), system, messages: [{ role: "user", content: user }] });
        inTok += resp.usage?.input_tokens ?? 0;
        outTok += resp.usage?.output_tokens ?? 0;
        const txt = (resp.content as Array<{ type: string; text?: string }>).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
        releve += `\n\n----- SEGMENT ${i + 1}/${total} · ${seg.label} -----\n${txt || `Segment ${i + 1} : RAS`}`;
        covered++;
        done = true;
      } catch (e) {
        if (e instanceof Error && e.name === "AiCancelledError") throw e;
        // Échec persistant : on N'INJECTE AUCUNE mention technique dans le relevé
        // éditorial (elle fuiterait dans le rapport). Le segment reste simplement
        // NON couvert — la couverture (coveredSegments/totalSegments) le reflète,
        // et l'appelant décide quoi faire (reprise / signalement technique).
      }
    }
    if (opts.onProgress) await opts.onProgress(i + 1, total);
  }
  return { releve: releve.trim(), coveredSegments: covered, totalSegments: total, inputTokens: inTok, outputTokens: outTok };
}
