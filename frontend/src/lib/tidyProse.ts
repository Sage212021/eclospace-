// Remise en forme d'un texte de prose collé « à plat ».
//
// Quand on copie-colle un avis (depuis un PDF, une page web, un assistant…), les
// retours à la ligne sont souvent perdus : les phrases se collent (« …
// francophone.L'auteur… ») et les intertitres se soudent au texte (« … du
// relecteurSynthèse de l'évaluation… »). Le rendu devient un bloc « touffu ».
//
// `tidyProse` répare ces deux cas SANS abîmer un texte déjà propre : il n'ajoute
// une espace ou un saut de paragraphe que là où le texte est manifestement
// aggloméré. Idempotent : l'appliquer deux fois donne le même résultat.

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

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function tidyProse(input: string | null | undefined): string {
  if (!input) return input ?? "";
  let t = input.replace(/\r\n?/g, "\n");

  // 1) Espace manquant après une ponctuation de fin de phrase collée à une
  //    capitale (ou un guillemet ouvrant). La lettre suivante DOIT être une
  //    capitale : « 7.86 » (chiffre après le point) n'est donc pas touché.
  t = t.replace(/([\p{L}0-9»)\]])([.?!…])(?=[«"“A-ZÀ-ÖØ-Þ])/gu, "$1$2 ");

  // 2) Isole chaque intertitre connu sur son propre paragraphe : saut AVANT
  //    (s'il s'est soudé au texte précédent) et saut APRÈS (si le corps se colle
  //    directement à l'intertitre, sans espace).
  for (const h of REVIEW_HEADINGS) {
    const esc = escapeRegExp(h);
    t = t.replace(new RegExp(`([^\\n])[ \\t]*(${esc})`, "g"), "$1\n\n$2");
    t = t.replace(new RegExp(`(${esc})(?=[«"“A-ZÀ-ÖØ-Þ])`, "g"), "$1\n\n");
  }

  // 3) Normalise les espaces et limite les sauts de ligne successifs.
  t = t
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return t;
}
