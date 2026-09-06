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

const clamp10 = (v: number): number => Math.max(0, Math.min(10, v));

// Note lue dans UNE cellule (colonne « Note »). Accepte : « 7/10 », « 7 / 20 »
// (ramené sur 10), un nombre seul « 7 » ou « 6,5 » (colonne dont l'en-tête est
// déjà « /10 »), un nombre 11–20 interprété comme /20, et ignore les jauges
// (« ███ 7 »). Virgule décimale acceptée. Null si aucune note.
function scoreFromCell(cell: string): number | null {
  const slash = cell.match(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d{1,2})\b/);
  if (slash) {
    const base = parseInt(slash[2], 10);
    let v = parseFloat(slash[1].replace(",", "."));
    if (base === 20) v = v / 2;
    if (Number.isFinite(v)) return clamp10(v);
  }
  const num = cell.match(/(\d+(?:[.,]\d+)?)/);
  if (num) {
    let v = parseFloat(num[1].replace(",", "."));
    if (!Number.isFinite(v)) return null;
    if (v > 10 && v <= 20) v = v / 2; // note manifestement sur 20
    if (v >= 0 && v <= 10) return v;
  }
  return null;
}

// Note d'une LIGNE, sans connaître la colonne : on privilégie « X/10 » (ou /20),
// non confondable avec le coefficient. Repli quand l'en-tête n'a pas été trouvé.
function scoreFromRow(cells: string[]): number | null {
  for (const cell of cells) {
    const m = cell.match(/(\d+(?:[.,]\d+)?)\s*\/\s*(10|20)\b/);
    if (m) {
      let v = parseFloat(m[1].replace(",", "."));
      if (m[2] === "20") v = v / 2;
      if (Number.isFinite(v)) return clamp10(v);
    }
  }
  return null;
}

const HEADER_HINTS = ["critère", "critere", "coefficient", "commentaire", "note"];

function splitRow(line: string): string[] {
  const cells = line.split("|").map((c) => c.trim());
  if (cells.length && cells[0] === "") cells.shift();
  if (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}
const isSeparatorRow = (cells: string[]): boolean => cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "");

// Analyse le texte d'un rapport et renvoie les couples (critère → note) trouvés
// dans le(s) tableau(x) Markdown. Détecte, via la ligne d'en-tête, la colonne
// « Critère » (libellé) et la colonne « Note » — ce qui permet de lire une note
// en NOMBRE SEUL sans la confondre avec le coefficient. À défaut d'en-tête, repli
// sur la forme « X/10 » présente dans la ligne. Ignore en-têtes/séparateurs,
// dédoublonne.
export function parseGrilleScores(reportText: string | null | undefined): ParsedCriterionScore[] {
  if (!reportText) return [];
  const out: ParsedCriterionScore[] = [];
  const seen = new Set<string>();
  let labelCol = 0;
  let noteCol = -1;
  for (const rawLine of reportText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) continue;
    const cells = splitRow(line);
    if (cells.length < 2) continue;
    if (isSeparatorRow(cells)) continue;

    // Ligne d'EN-TÊTE ? (contient « note » et « critère »/« coefficient »)
    const low = cells.map((c) => c.toLowerCase());
    const noteIdx = low.findIndex((c) => /\bnotes?\b/.test(c));
    const critIdx = low.findIndex((c) => /crit[eè]re/.test(c));
    if (noteIdx !== -1 && (critIdx !== -1 || low.some((c) => /coefficient/.test(c)))) {
      noteCol = noteIdx;
      labelCol = critIdx !== -1 ? critIdx : 0;
      continue; // c'est l'en-tête, pas une donnée
    }

    // Ligne de DONNÉES.
    const label = cleanLabel(cells[labelCol] ?? cells[0] ?? "");
    if (!label) continue;
    const llow = label.toLowerCase();
    if (HEADER_HINTS.some((h) => llow === h || llow.startsWith(h + " "))) continue;
    if (/^(total|score global|score|moyenne)\b/.test(llow)) continue;

    let score: number | null = null;
    if (noteCol !== -1 && cells[noteCol] !== undefined) score = scoreFromCell(cells[noteCol]);
    if (score === null) score = scoreFromRow(cells.slice(1)); // repli : « X/10 » dans la ligne
    if (score === null) continue;
    if (seen.has(llow)) continue;
    seen.add(llow);
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
