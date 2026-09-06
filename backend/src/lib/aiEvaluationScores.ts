// Extraction des notes par critère depuis un rapport IA d'évaluation.
//
// Le rapport IA est stocké en TEXTE (Markdown) : la grille (rubrique C) y est un
// tableau « | Critère | Coefficient | Note /10 | Commentaire | ». On en retire,
// de façon prudente, les couples (libellé du critère → note sur 10) pour pouvoir
// pré-remplir les curseurs du relecteur dans « Mes lectures ». Le relecteur reste
// libre d'ajuster chaque note ensuite.

export interface ParsedCriterionScore {
  label: string;
  score: number; // toujours ramené sur 10
}

// Enlève le gras Markdown et normalise les espaces d'un libellé de cellule.
function cleanLabel(cell: string): string {
  return cell
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Cherche une note dans une ligne de tableau : on privilégie la forme « X/10 »
// (ou « X/20 », ramenée sur 10), la plus fiable car non confondable avec le
// coefficient. `virgule` décimale acceptée. Renvoie null si aucune note fiable.
function extractScore(cells: string[]): number | null {
  for (const cell of cells) {
    const m = cell.match(/(\d+(?:[.,]\d+)?)\s*\/\s*(10|20)\b/);
    if (m) {
      let value = parseFloat(m[1].replace(",", "."));
      if (m[2] === "20") value = value / 2;
      if (Number.isFinite(value)) return Math.max(0, Math.min(10, value));
    }
  }
  return null;
}

const HEADER_HINTS = ["critère", "critere", "coefficient", "commentaire", "note"];

// Analyse le texte d'un rapport et renvoie les couples (critère → note) trouvés
// dans le(s) tableau(x) Markdown. Prudent : ignore les lignes d'en-tête et de
// séparation, ne retient que les lignes portant une note fiable, dédoublonne.
export function parseGrilleScores(reportText: string | null | undefined): ParsedCriterionScore[] {
  if (!reportText) return [];
  const out: ParsedCriterionScore[] = [];
  const seen = new Set<string>();
  for (const rawLine of reportText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) continue;
    // Cellules de la ligne (on retire les bords vides).
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length && cells[0] === "") cells.shift();
    if (cells.length && cells[cells.length - 1] === "") cells.pop();
    if (cells.length < 2) continue;
    // Ligne de séparation « ---|:--: » ?
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue;
    const label = cleanLabel(cells[0]);
    if (!label) continue;
    // Ligne d'en-tête ?
    const low = label.toLowerCase();
    if (HEADER_HINTS.some((h) => low === h || low.startsWith(h + " "))) continue;
    const score = extractScore(cells.slice(1));
    if (score === null) continue;
    const key = low;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, score });
  }
  return out;
}

// Normalisation d'un libellé pour rapprocher un critère de la grille d'un libellé
// lu dans le rapport (sans accents, minuscules, alphanumérique compact).
export function normalizeLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
