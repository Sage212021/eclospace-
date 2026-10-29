import type Anthropic from "@anthropic-ai/sdk";
import { withThinking } from "./aiThinking.js";

// Budget de « réflexion approfondie » par segment (jetons de raisonnement) quand
// le modèle la gère (Sonnet/Opus). Le relecteur réfléchit avant de lister les
// anomalies du segment — meilleure détection des coquilles fines.
const SWEEP_THINK_BUDGET = 3000;

// ─────────────────────────────────────────────────────────────────────────
// Lecture INTÉGRALE par segments (renforcement BAT1/BAT2, demande opérateur).
// Le défaut historique : pour un manuscrit volumineux, le moteur n'analysait
// qu'un « extrait représentatif » (début/milieu/fin) en un seul appel — il
// passait donc à côté des erreurs des passages non lus. Ici, on découpe le
// manuscrit en segments ORDONNÉS couvrant TOUT le texte, on relève les
// anomalies segment par segment, et on consolide — avec une couverture vérifiée
// (N/N segments). Le relevé alimente ensuite le rapport structuré.
// ─────────────────────────────────────────────────────────────────────────

// Taille d'un segment de lecture. VOLONTAIREMENT COURTE (~7 pages) : sur un bloc
// trop long, le modèle « survole » et laisse passer les coquilles de surface
// (orthographe d'un nom propre, accord ou accent ponctuel). Des segments courts
// forcent une lecture fine, phrase par phrase — meilleure détection des coquilles
// (verrouillage demandé par l'opérateur après des coquilles passées en BAT1/BAT2).
export const SEGMENT_CHARS = 12_000;

// Découpe le texte en segments d'environ maxChars, sur des frontières de
// paragraphe quand c'est possible (sinon coupe nette). Conserve TOUT le texte,
// dans l'ordre. Un paragraphe plus long que maxChars est tranché tel quel.
export function segmentText(text: string, maxChars: number): string[] {
  const t = (text ?? "").trim();
  if (!t) return [];
  if (t.length <= maxChars) return [t];
  const paras = t.split(/\n{2,}/);
  const segs: string[] = [];
  let buf = "";
  const flush = () => { if (buf.trim()) segs.push(buf.trim()); buf = ""; };
  for (const p of paras) {
    if (p.length > maxChars) {
      flush();
      for (let i = 0; i < p.length; i += maxChars) segs.push(p.slice(i, i + maxChars));
      continue;
    }
    if (buf.length + p.length + 2 > maxChars) flush();
    buf = buf ? `${buf}\n\n${p}` : p;
  }
  flush();
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
  segments: string[];
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
    "Tu n'écris NI préambule NI conclusion : seulement la liste.\n\n" +
    opts.methodBlock;

  let releve = "";
  let covered = 0;
  let inTok = 0;
  let outTok = 0;
  for (let i = 0; i < total; i++) {
    if (opts.beforeEach) await opts.beforeEach();
    const user =
      `=== SEGMENT ${i + 1}/${total} (à lire INTÉGRALEMENT) ===\n${opts.segments[i]}\n\n` +
      "=== CONSIGNE ===\n" +
      "Relève TOUTES les anomalies de CE segment, une par ligne, au format :\n" +
      "- [catégorie · sévérité C1/C2/C3/S] « passage fautif cité exactement » → correction proposée (justification courte si utile)\n" +
      `Si le segment ne contient aucune anomalie, écris exactement : « Segment ${i + 1} : RAS ».`;
    // Jusqu'à 2 tentatives : un incident ponctuel sur un segment ne doit pas
    // laisser un trou de couverture ni une mention technique dans le relevé.
    let done = false;
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      try {
        const resp = await opts.client.messages.create({ model: opts.model, ...withThinking(opts.model, opts.maxTokens ?? 4000, SWEEP_THINK_BUDGET), system, messages: [{ role: "user", content: user }] });
        inTok += resp.usage?.input_tokens ?? 0;
        outTok += resp.usage?.output_tokens ?? 0;
        const txt = (resp.content as Array<{ type: string; text?: string }>).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
        releve += `\n\n----- SEGMENT ${i + 1}/${total} -----\n${txt || `Segment ${i + 1} : RAS`}`;
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
