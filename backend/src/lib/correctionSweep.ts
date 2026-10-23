import type Anthropic from "@anthropic-ai/sdk";

// ─────────────────────────────────────────────────────────────────────────
// Lecture INTÉGRALE par segments (renforcement BAT1/BAT2, demande opérateur).
// Le défaut historique : pour un manuscrit volumineux, le moteur n'analysait
// qu'un « extrait représentatif » (début/milieu/fin) en un seul appel — il
// passait donc à côté des erreurs des passages non lus. Ici, on découpe le
// manuscrit en segments ORDONNÉS couvrant TOUT le texte, on relève les
// anomalies segment par segment, et on consolide — avec une couverture vérifiée
// (N/N segments). Le relevé alimente ensuite le rapport structuré.
// ─────────────────────────────────────────────────────────────────────────

// Taille d'un segment de lecture. En deçà, un manuscrit tient en un seul segment
// et le balayage n'apporte rien (on garde alors la lecture en un appel).
export const SEGMENT_CHARS = 48_000;

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
    "On te donne UN SEGMENT d'un manuscrit. Tu le lis INTÉGRALEMENT, phrase par phrase (jamais un échantillon), et tu relèves TOUTES ses anomalies, sans en inventer aucune. " +
    "Anomalies visées : coquilles, fautes d'orthographe, d'accord, de grammaire et de conjugaison, erreurs de syntaxe, de ponctuation et de typographie, mots manquants ou en trop, répétitions injustifiées, incohérences (noms propres, dates, chiffres, titres, références), formulations ambiguës. " +
    "Tu distingues l'ERREUR CERTAINE de la simple SUGGESTION de style : une préférence stylistique n'est jamais présentée comme une faute. " +
    "Tu ne réduis pas artificiellement le nombre d'anomalies : il correspond à ce que CE segment contient réellement. " +
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
    try {
      const resp = await opts.client.messages.create({ model: opts.model, max_tokens: opts.maxTokens ?? 4000, system, messages: [{ role: "user", content: user }] });
      inTok += resp.usage?.input_tokens ?? 0;
      outTok += resp.usage?.output_tokens ?? 0;
      const txt = (resp.content as Array<{ type: string; text?: string }>).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
      releve += `\n\n----- SEGMENT ${i + 1}/${total} -----\n${txt || `Segment ${i + 1} : RAS`}`;
      covered++;
    } catch (e) {
      if (e instanceof Error && e.name === "AiCancelledError") throw e;
      releve += `\n\n----- SEGMENT ${i + 1}/${total} -----\n(Segment non analysé : incident technique sur ce segment.)`;
    }
    if (opts.onProgress) await opts.onProgress(i + 1, total);
  }
  return { releve: releve.trim(), coveredSegments: covered, totalSegments: total, inputTokens: inTok, outputTokens: outTok };
}
