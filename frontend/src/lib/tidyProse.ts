import type { ClipboardEvent } from "react";

// Remise en forme d'un texte de prose collé « à plat ».
//
// Quand on copie-colle un texte (depuis un PDF, une page web, un assistant…),
// les retours à la ligne sont souvent perdus : les phrases se collent (« …
// francophone.L'auteur… ») et, dans un rapport de lecture, les intertitres se
// soudent au texte (« …du relecteurSynthèse de l'évaluation… »). Le rendu
// devient un bloc « touffu ».
//
// Deux fonctions :
//   • `tidyProse`  — GÉNÉRIQUE : rétablit les espaces entre phrases et normalise
//     les blancs. Convient à tout champ de prose (motivation, message à
//     l'auteur, clause de contrat…).
//   • `tidyReadingAppreciation` — le générique PLUS l'isolement des intertitres
//     propres au rapport de lecture, sur leur propre paragraphe.
//
// Toutes deux SANS effet sur un texte déjà propre, et idempotentes.

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Générique : espace manquant après une ponctuation de fin de phrase collée à
// une capitale (ou un guillemet ouvrant), puis normalisation des blancs. La
// lettre suivante DOIT être une capitale : « 7.86 » (chiffre après le point)
// n'est donc pas touché.
export function tidyProse(input: string | null | undefined): string {
  if (!input) return input ?? "";
  let t = input.replace(/\r\n?/g, "\n");
  t = t.replace(/([\p{L}0-9»)\]])([.?!…])(?=[«"“A-ZÀ-ÖØ-Þ])/gu, "$1$2 ");
  return normalizeBlanks(t);
}

function normalizeBlanks(t: string): string {
  return t
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Intertitres DISTINCTIFS du rapport de lecture / de l'avis du relecteur. On ne
// retient que des expressions à plusieurs mots, peu susceptibles d'apparaître au
// fil d'une phrase, pour éviter les faux découpages.
const REVIEW_HEADINGS = [
  "Avis final du relecteur",
  "Synthèse de l'évaluation",
  "Synthèse générale",
  "Recommandation finale",
  "Recommandation du relecteur",
  "Adéquation finale avec la ligne d'Éclosion",
  "Adéquation finale avec la ligne éditoriale",
  "Adéquation finale avec la ligne",
  "Enjeux et opportunités",
  "Postface du relecteur",
  "Points de vigilance",
  "Pour le lecteur",
  "Pour Éclosion",
]
  // Traiter les intertitres les plus LONGS d'abord (« … la ligne d'Éclosion »
  // avant « … la ligne ») pour ne pas couper à l'intérieur d'un intitulé.
  .sort((a, b) => b.length - a.length);

// Spécifique au rapport de lecture : le générique + chaque intertitre connu
// isolé sur son propre paragraphe (saut AVANT s'il s'est soudé au texte
// précédent, saut APRÈS si le corps se colle directement à l'intertitre).
export function tidyReadingAppreciation(input: string | null | undefined): string {
  if (!input) return input ?? "";
  let t = input.replace(/\r\n?/g, "\n");
  t = t.replace(/([\p{L}0-9»)\]])([.?!…])(?=[«"“A-ZÀ-ÖØ-Þ])/gu, "$1$2 ");

  // Séparateur horizontal (« --- », « — — — ») laissé par certains assistants →
  // saut de paragraphe.
  t = t.replace(/[ \t]*[-–—]{3,}[ \t]*/g, "\n\n");

  for (const h of REVIEW_HEADINGS) {
    const esc = escapeRegExp(h);
    t = t.replace(new RegExp(`([^\\n])[ \\t]*(${esc})`, "g"), "$1\n\n$2");
    t = t.replace(new RegExp(`(${esc})(?=[«"“A-ZÀ-ÖØ-Þ])`, "g"), "$1\n\n");
  }

  // Mentions de bas de rapport (avertissement de portée) : toujours détachées du
  // dernier paragraphe (saut AVANT). Les plus longues d'abord pour éviter un
  // double saut sur les préfixes communs.
  for (const p of REPORT_DISCLAIMERS) {
    const esc = escapeRegExp(p);
    t = t.replace(new RegExp(`([^\\n])[ \\t]*(${esc})`, "g"), "$1\n\n$2");
  }

  return normalizeBlanks(t);
}

// Avertissements de portée figurant en fin de rapport, à isoler sur leur propre
// paragraphe (« Ce rapport constitue un avis argumenté de relecteur et ne… »).
const REPORT_DISCLAIMERS = [
  "Ce rapport constitue un avis argumenté de relecteur",
  "Ce rapport est un avis argumenté de relecteur",
  "Ce rapport constitue un avis argumenté",
  "Ce rapport est un avis argumenté",
].sort((a, b) => b.length - a.length);

// Handler `onPaste` réutilisable pour un <textarea> contrôlé : insère le texte
// collé, remis en forme, à l'emplacement du curseur (en remplaçant la sélection
// éventuelle). `tidy` permet de choisir la variante (générique par défaut).
export function pasteTidied(
  e: ClipboardEvent<HTMLTextAreaElement>,
  current: string,
  setValue: (next: string) => void,
  tidy: (s: string | null | undefined) => string = tidyProse,
): void {
  const pasted = e.clipboardData.getData("text");
  if (!pasted) return;
  e.preventDefault();
  const el = e.currentTarget;
  const start = el.selectionStart ?? current.length;
  const end = el.selectionEnd ?? current.length;
  setValue(current.slice(0, start) + tidy(pasted) + current.slice(end));
}
