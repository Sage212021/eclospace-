// Garde-fou de qualité éditoriale (demande opérateur) : un rapport de relecture
// (BAT1/BAT2) ou d'évaluation NE DOIT JAMAIS contenir de formulation révélant une
// LIMITATION TECHNIQUE du système (extraction incomplète, lecture interrompue,
// « extrait représentatif »…). Ces mentions, quand elles existent, sont le signe
// d'un problème interne — pas un constat éditorial — et trompent le lecteur.
//
// IMPORTANT : on NE supprime PAS les vraies anomalies éditoriales du manuscrit
// (phrase inachevée, chapitre manquant, rupture narrative) LORSQU'ELLES PORTENT
// SUR LE RÉCIT / LE TEXTE DE L'AUTEUR. On ne retire que les phrases qui parlent
// d'une limite de LECTURE / D'EXTRACTION / DU FICHIER / DU SYSTÈME.

// Motifs « limitation technique » : une phrase n'est retirée que si elle évoque
// explicitement le traitement du fichier / la lecture par le système.
const TECH_LIMITATION_PATTERNS: RegExp[] = [
  /\bje\s+n['’]?ai\s+pas\s+pu\s+(?:lire|analyser|extraire|traiter|accéder)/i,
  /\bn['’]?(?:a|ont)\s+pas\s+pu\s+être\s+(?:lu|lue|lus|lues|extrait|extraits|analysé|analysée|analysés|traité|traités)/i,
  /\blimitation\s+(?:de\s+lecture|technique|du\s+système|d['’]?extraction|de\s+traitement)/i,
  /\bextrait\s+repr[ée]sentatif\b/i,
  /\b(?:le|ce|du)\s+(?:document|fichier|manuscrit|texte)\s+(?:semble|para[iî]t|appara[iî]t)\s+(?:avoir\s+été\s+)?(?:coup[ée]|tronqu[ée]|incomplet|interrompu)/i,
  /\b(?:le|ce|du)\s+(?:document|fichier|manuscrit)\s+s['’]?arr[eê]te\s+(?:brusquement|abruptement|de\s+mani[eè]re\s+abrupte)/i,
  /\bl['’]?analyse\s+(?:s['’]?arr[eê]te|se\s+limite|a\s+été\s+interrompue)\s+(?:à|au|aux|en\s+raison)/i,
  /\ben\s+raison\s+d['’]?une\s+limitation/i,
  /\bune\s+partie\s+(?:du|de\s+ce)\s+(?:manuscrit|document|fichier)\s+n['’]?a\s+pas\s+(?:pu\s+)?(?:été\s+)?(?:lue|analysée|trait[ée]e)/i,
  /\b(?:lecture|extraction|analyse)\s+(?:partielle|incompl[eè]te)\s+(?:du|de\s+ce)\s+(?:fichier|document|manuscrit)/i,
  /\bprobl[eè]me\s+(?:technique|d['’]?extraction|de\s+lecture)\b/i,
];

function isTechnicalLimitation(sentence: string): boolean {
  return TECH_LIMITATION_PATTERNS.some((re) => re.test(sentence));
}

// Nettoie un rapport éditorial : retire les PHRASES révélant une limitation
// technique, en préservant la structure (titres, puces, lignes) et tout le reste
// du contenu éditorial. Renvoie le texte nettoyé et le nombre de phrases retirées.
export function sanitizeEditorialReport(report: string): { text: string; removed: number } {
  if (!report) return { text: report, removed: 0 };
  let removed = 0;
  const lines = report.split("\n");
  const out = lines.map((line) => {
    // On ne touche pas aux titres de rubrique (## …) ni aux lignes vides.
    if (!line.trim() || /^\s*#{1,6}\s/.test(line)) return line;
    // Découpe la ligne en phrases (ponctuation forte) et retire celles qui
    // parlent d'une limitation technique ; garde les autres telles quelles.
    const pieces = line.split(/(?<=[.!?…])\s+/);
    const kept = pieces.filter((p) => {
      if (isTechnicalLimitation(p)) { removed++; return false; }
      return true;
    });
    const rebuilt = kept.join(" ").replace(/\s{2,}/g, " ").trimEnd();
    return rebuilt;
  });
  // Évite d'empiler des lignes vides créées par la suppression.
  const text = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text, removed };
}
