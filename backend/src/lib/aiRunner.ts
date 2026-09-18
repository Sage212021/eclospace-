import zlib from "node:zlib";
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, TableLayoutType } from "docx";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./prisma.js";
import { storeFile } from "./storage.js";
import { writeAuditLog } from "./audit.js";
import { loadConfig, readApiKey, resolveModelId, type WorkType } from "./aiConfig.js";

// Moteur de relecture assistée (Lot IA-1). Orchestration : préparer le manuscrit,
// appeler Claude AU NOM du relecteur d'Éclosion, générer le rapport .docx, le
// classer dans la GED et historiser le tout (AiReadingJob). L'IA ne décide rien.

// Tarifs API (USD / million de tokens) pour l'estimation de coût affichée.
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-opus-5": { in: 5, out: 25 },
};

export class AiRunError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// Texte d'un .docx : on dézippe word/document.xml et on retire le balisage.
function docxToText(buffer: Buffer): string {
  // Un .docx est un ZIP ; on lit l'entrée word/document.xml sans dépendance ZIP
  // en cherchant l'en-tête local — mais plus simple et robuste : on tente une
  // décompression des flux DEFLATE. Ici on s'appuie sur la présence du XML en
  // clair après inflation de chaque entrée.
  const text = extractDocxXml(buffer);
  if (!text) return "";
  const paras = text.split(/<\/w:p>/).map((p) => {
    const runs = [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
    return runs
      .join("")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#8217;/g, "’").replace(/&#8230;/g, "…");
  });
  return paras.filter((l) => l.trim()).join("\n");
}

// Extraction de word/document.xml d'un ZIP .docx (entrées DEFLATE ou STORE).
function extractDocxXml(buffer: Buffer): string | null {
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break; // signature d'entrée locale
    const method = buffer.readUInt16LE(offset + 8);
    const compSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString("utf8", offset + 30, offset + 30 + nameLen);
    const dataStart = offset + 30 + nameLen + extraLen;
    const data = buffer.subarray(dataStart, dataStart + compSize);
    if (name === "word/document.xml") {
      try {
        return method === 0 ? data.toString("utf8") : zlib.inflateRawSync(data).toString("utf8");
      } catch {
        return null;
      }
    }
    offset = dataStart + compSize;
  }
  return null;
}

type ManuscriptInput = { kind: "text"; text: string } | { kind: "pdf"; base64: string };

function isPdfBuffer(mime: string, buffer: Buffer): boolean {
  return mime === "application/pdf" || buffer.subarray(0, 5).toString("latin1") === "%PDF-";
}

// Extraction du texte d'un PDF côté serveur (pdfjs-dist). Permet d'analyser des
// PDF de PLUS de 100 pages — que l'IA refuse en pièce jointe — en les envoyant
// comme TEXTE. Renvoie null si le PDF est illisible ou sans texte (PDF scanné/
// image) : on retombe alors sur l'envoi du PDF tel quel.
export async function extractPdfText(buffer: Buffer, charBudget: number): Promise<{ text: string; pages: number } | null> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true, disableFontFace: true }).promise;
    const parts: string[] = [];
    let total = 0;
    const maxPages = Math.min(doc.numPages, 3000); // borne de sécurité
    for (let p = 1; p <= maxPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const line = content.items.map((it) => ("str" in it ? (it as { str: string }).str : "")).join(" ").replace(/[ \t]+/g, " ").trim();
      parts.push(line);
      total += line.length;
      // On arrête tôt si l'on a déjà bien plus que le budget (le texte sera de
      // toute façon ramené à un extrait représentatif ensuite).
      if (total > charBudget * 1.4) break;
    }
    await doc.cleanup?.();
    const text = parts.join("\n\n").trim();
    return { text, pages: doc.numPages };
  } catch {
    return null;
  }
}

function prepareManuscript(mime: string, name: string, buffer: Buffer): ManuscriptInput {
  const lower = name.toLowerCase();
  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    return { kind: "pdf", base64: buffer.toString("base64") };
  }
  if (mime.includes("wordprocessingml") || lower.endsWith(".docx")) {
    return { kind: "text", text: docxToText(buffer) };
  }
  return { kind: "text", text: buffer.toString("utf8") };
}

// Grille d'évaluation OFFICIELLE de la maison (critères + coefficients, en base),
// ADAPTÉE au type de manuscrit (domaine) : grille propre au domaine si elle
// existe, sinon grille par défaut. Transmise à l'IA pour qu'elle s'y TIENNE.
async function evaluationGrilleText(genreId: string | null | undefined): Promise<string> {
  const { effectiveCriteria } = await import("./evaluationGrid.js");
  const crit = await effectiveCriteria(genreId);
  if (!crit.length) return "(grille non configurée)";
  const lines = crit.map((c) => `- ${c.label} (coefficient ${Number(c.coefficient)})`).join("\n");
  const sum = crit.reduce((s, c) => s + Number(c.coefficient), 0);
  return `${lines}\nSomme des coefficients = ${sum}. Score global = Σ(note × coefficient) / Σ(coefficients), chaque note sur 10.`;
}

// CHARTE par collection (périmètre éditorial : ce qu'elle publie / exclut). C'est
// la « ligne éditoriale » réelle — pas une simple liste de genres. Validée par la
// Direction (06/09/2026). L'IA juge l'adéquation UNIQUEMENT contre la charte de la
// collection DÉCLARÉE du manuscrit, sans comparer aux autres collections.
const COLLECTION_CHARTERS: Record<string, string> = {
  CANARIE:
    "Création littéraire (adulte). Inclut : roman, nouvelle, théâtre, poésie — œuvres de fiction et d'expression littéraire, lectorat adulte/grand public. Exclut : ouvrages de savoir ou pratiques (→ Sources), livres pour la jeunesse (→ Héritier).",
  HERITIER:
    "Jeunesse & patrimoine. Inclut : littérature jeunesse (albums, premières lectures, romans jeunesse), contes & légendes, ouvrages de transmission destinés aux enfants/adolescents. Exclut : ouvrages visant d'abord un lectorat adulte.",
  SOURCES:
    "Savoir, réflexion & pratique. Inclut : essai, sciences humaines & économie, développement personnel, document & actualité, témoignage & biographie, manuel scolaire ou guide pratique — toute la non-fiction (analyse, connaissance, expérience, méthode). Exclut : fiction littéraire (→ Canarie), ouvrages jeunesse (→ Héritier).",
};

// Règle TRANSVERSALE thème/doctrine (vaut pour toutes les collections) : un thème
// spirituel/religieux dans une œuvre est légitime et n'affecte PAS l'adéquation ;
// seule la posture doctrinale (endoctrinement, prosélytisme, fanatisme) est un
// motif de vigilance rédhibitoire.
const THEME_DOCTRINE_RULE =
  "Règle transversale (toutes collections) — spiritualité/religieux : ce n'est PAS un domaine publié en soi, mais l'aborder comme THÈME, décor ou ressort narratif (un roman où l'on prie, doute, vit une expérience spirituelle) est LÉGITIME et n'abaisse EN RIEN l'adéquation. En revanche, signale en « points de vigilance » — comme motif possiblement RÉDHIBITOIRE, indépendamment du score — tout manuscrit à visée d'endoctrinement, de prosélytisme, d'apologie religieuse, ou au discours fanatique/sectaire.";

export async function domainesCollectionsText(): Promise<string> {
  const [genres, collections] = await Promise.all([
    prisma.genre.findMany({ where: { deletedAt: null }, orderBy: { label: "asc" } }),
    prisma.collection.findMany({ where: { deletedAt: null, code: { in: Object.keys(COLLECTION_CHARTERS) } }, orderBy: { label: "asc" } }),
  ]);
  // Présentation par COLLECTION : sa CHARTE (périmètre) + les domaines qu'elle
  // couvre. L'IA ancre ainsi le critère « adéquation » sur la ligne réelle.
  const blocks = collections.map((c) => {
    const domaines = genres.filter((g) => g.collectionId === c.id).map((g) => g.label);
    const list = domaines.length ? domaines.join(", ") : "(aucun domaine rattaché)";
    const charter = COLLECTION_CHARTERS[c.code] ?? "";
    return `- ${c.label} — ${charter}\n  Domaines : ${list}`;
  });
  return [
    "Ligne éditoriale d'Éclosion Édition — trois collections, chacune avec son périmètre :",
    ...blocks,
    THEME_DOCTRINE_RULE,
  ].join("\n");
}

function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? "");
}

// Budget de sortie PAR APPEL. Volontairement SOUS la limite de sortie des
// modèles Claude (8192 pour Haiku) : au-delà, l'API rejette la requête (400) et
// tout le job échoue — l'utilisateur reste alors sur l'ancien rapport tronqué.
// La complétude A→M n'est PAS assurée par un gros budget (risqué), mais par la
// boucle de complétion ci-dessous, qui enchaîne plusieurs appels au besoin.
const REPORT_MAX_TOKENS = 8000;

// Rubriques du gabarit ABSENTES du texte produit. Une rubrique est « présente »
// si son intitulé de section apparaît (ex. « ## A. … », « **A.** », « A. … » en
// début de ligne). Sert à garantir qu'un rapport contient TOUTES ses rubriques.
export function missingSectionKeys(reportText: string, keys: string[]): string[] {
  return keys.filter((k) => {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|\\n)\\s*(#{1,6}\\s*)?\\*{0,2}\\s*${esc}\\s*[.)]`, "i");
    return !re.test(reportText);
  });
}

// Index (dans `text`) du PREMIER intitulé de rubrique parmi `keys`. Sert à ne
// garder, dans une complétion, que le contenu À PARTIR de la rubrique demandée —
// et à jeter tout préambule/« méta » que l'IA aurait ajouté avant (ce qui
// trahirait une rédaction par IA). Renvoie -1 si aucune rubrique demandée.
export function firstSectionHeadingIndex(text: string, keys: string[]): number {
  let best = -1;
  for (const k of keys) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|\\n)(\\s*(?:#{1,6}\\s*)?\\*{0,2}\\s*${esc}\\s*[.)])`, "i");
    const m = re.exec(text);
    if (m) {
      const idx = m.index + (m[1] ? m[1].length : 0);
      if (best < 0 || idx < best) best = idx;
    }
  }
  return best;
}

// Borne de sécurité du texte de manuscrit envoyé à l'IA : la fenêtre de contexte
// est limitée (≈ 200 000 tokens). Au-delà du budget, on envoie un EXTRAIT
// REPRÉSENTATIF (début + milieu + fin) plutôt que d'échouer — suffisant pour une
// évaluation d'ensemble ; le rapport le signale.
//
// ⚠️ Le français dense (mots accentués, technique) tokenise BEAUCOUP plus serré
// que l'estimation naïve « 4 caractères ≈ 1 token » : on a mesuré ~1,9 car./token
// (un manuscrit de 500 000 car. atteignait 258 705 tokens et était REFUSÉ). On
// prend donc un ratio prudent d'~2 car./token et une BONNE MARGE : 240 000 car.
// ≈ 120 000 tokens de manuscrit, + le prompt (grille, structure) ≈ 130 000 tokens
// au total, très en deçà des 200 000 — sans risque de « prompt too long ».
export const MANUSCRIT_CHAR_BUDGET = 240_000;
export function capManuscriptText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MANUSCRIT_CHAR_BUDGET) return { text, truncated: false };
  const head = Math.floor(MANUSCRIT_CHAR_BUDGET * 0.5);
  const mid = Math.floor(MANUSCRIT_CHAR_BUDGET * 0.25);
  const tail = MANUSCRIT_CHAR_BUDGET - head - mid;
  const midStart = Math.max(head, Math.floor(text.length / 2 - mid / 2));
  const parts = [
    text.slice(0, head),
    "\n\n[…] (extrait — passage central du manuscrit) [...]\n\n",
    text.slice(midStart, midStart + mid),
    "\n\n[…] (extrait — fin du manuscrit) [...]\n\n",
    text.slice(text.length - tail),
  ];
  return { text: parts.join(""), truncated: true };
}

// Récupère le texte du rapport de couverture du BAT PRÉCÉDENT (dernière relecture
// de couverture terminée sur cet ouvrage, autre que le job courant) — pour que le
// BAT2 puisse suivre les corrections effectivement demandées au passage précédent.
async function findPreviousCoverReportText(manuscriptId: string, currentJobId: string): Promise<string | null> {
  const prev = await prisma.aiReadingJob.findFirst({
    where: { manuscriptId, workType: "couverture", status: "termine", id: { not: currentJobId } },
    orderBy: [{ finishedAt: "desc" }, { launchedAt: "desc" }],
  });
  const ids = Array.isArray(prev?.producedDocumentIds) ? (prev!.producedDocumentIds as string[]) : [];
  if (!ids.length) return null;
  const version = await prisma.documentVersion.findFirst({ where: { document: { id: ids[0] } }, orderBy: { versionNumber: "desc" } });
  if (!version) return null;
  const { readStoredFile } = await import("./storage.js");
  const buffer = await readStoredFile(version.filePath);
  const text = docxToText(buffer);
  return text ? text.slice(0, 12000) : null; // borne de sécurité (tokens)
}

// Identité visuelle « Noir souverain » d'Éclosion (charte, D-022) appliquée au
// rapport : or = marque/accent, noir = titres/structure, ivoire = zébrures de
// tableau. Aucun bleu (l'ancien rendu utilisait le bleu par défaut de Word).
const ECL = { or: "D9B21A", orDark: "9A7A12", noir: "0B0B0C", ink: "222222", grey: "5B6472", ivoire: "FAF8F2", line: "E7E2D4", white: "FFFFFF" };
const FONT = "Calibri";

// Découpe un texte en fragments gras/normaux (**gras** Markdown) → TextRun[].
function inlineRuns(text: string, opts: { color?: string; size?: number; bold?: boolean } = {}): TextRun[] {
  const size = opts.size ?? 21;
  const color = opts.color ?? ECL.ink;
  const runs: TextRun[] = [];
  for (const part of text.split(/(\*\*[^*]+\*\*)/g)) {
    if (!part) continue;
    const m = /^\*\*([^*]+)\*\*$/.exec(part);
    const clean = (m ? m[1] : part).replace(/\*\*/g, "").replace(/\s+$/, (s) => s);
    runs.push(new TextRun({ text: clean, bold: opts.bold || Boolean(m), color, size, font: FONT }));
  }
  return runs.length ? runs : [new TextRun({ text: "", size, font: FONT })];
}

function splitCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

// Jauge visuelle d'un score (« 16/20 », « 8/10 ») : le chiffre + une barre en
// blocs (portion atteinte en or, reste en gris clair), à la manière des modèles
// maison. Renvoie null si la cellule n'est pas un score.
function scoreRuns(text: string): TextRun[] | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*\/\s*(10|20)\s*$/.exec(text);
  if (!m) return null;
  const val = parseFloat(m[1].replace(",", "."));
  const max = Number(m[2]);
  const units = 10;
  const filled = Math.max(0, Math.min(units, Math.round((val / max) * units)));
  return [
    new TextRun({ text: `${m[1]}/${m[2]}  `, bold: true, color: ECL.orDark, size: 19, font: FONT }),
    new TextRun({ text: "█".repeat(filled), color: ECL.or, size: 19, font: FONT }),
    new TextRun({ text: "█".repeat(units - filled), color: ECL.line, size: 19, font: FONT }),
  ];
}

// Un tableau « clé : valeur » (ex. Identification : Élément | Détail) — à
// rendre en TEXTE plutôt qu'en tableau à colonnes étroites (qui empile le texte
// sur de nombreuses lignes et gaspille du papier à l'impression).
function isKeyValueTable(rows: string[][]): boolean {
  if (rows.length < 2 || (rows[0]?.length ?? 0) !== 2) return false;
  const h0 = (rows[0][0] || "").toLowerCase();
  const h1 = (rows[0][1] || "").toLowerCase();
  return /d[ée]tail|valeur|information|renseignement/.test(h1) || /^(élément|information|champ|rubrique|document|donnée)/.test(h0);
}

// Rendu « clé : valeur » compact (une ligne par entrée), sans tableau.
function keyValueBlock(rows: string[][]): Paragraph[] {
  return rows.slice(1).map((r) => new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({ text: (r[0] || "").replace(/\*\*/g, "").trim() + " : ", bold: true, color: ECL.noir, size: 20, font: FONT }),
      ...inlineRuns((r[1] || "").trim(), { color: ECL.ink, size: 20 }),
    ],
  }));
}

// Largeurs de colonnes (en dixièmes de point, DXA) calculées d'après les
// en-têtes : colonnes de synthèse (commentaire, explication, observation…)
// larges ; colonnes courtes (n°, coefficient, note, page, sévérité, statut)
// étroites — pour que le texte respire et que les lignes soient moins hautes.
function columnWidths(header: string[]): number[] {
  const TOTAL = 9020; // largeur utile A4 portrait (marges par défaut)
  const weights = header.map((h) => {
    const t = h.toLowerCase().trim();
    if (/^n°|^n$|coef|^note|^\/1|^\/2|^page|s[ée]v|statut|note ?\//.test(t)) return 0.7;
    if (/commentaire|explication|observation|constat|recommandation|correction|texte original|d[ée]tail|améliorat|demand/.test(t)) return 3.0;
    return 1.5;
  });
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => Math.max(650, Math.round((TOTAL * w) / sum)));
}

// Tableau (ex. grille d'évaluation) : en-tête noir/texte blanc, zébrure ivoire,
// colonnes numériques centrées, filets discrets — rendu maison Éclosion.
// Largeurs FIXES pour une mise en page économe en papier.
function buildTable(rows: string[][]): Table {
  const b = { style: BorderStyle.SINGLE, size: 2, color: ECL.line };
  const borders = { top: b, bottom: b, left: b, right: b };
  const header = rows[0] ?? [];
  const widths = columnWidths(header);
  const numericCol = (ci: number) => /coef|^note|^\/1|^\/2/.test((header[ci] || "").toLowerCase().trim());
  const headRow = new TableRow({
    tableHeader: true,
    children: header.map((h, ci) => new TableCell({
      width: { size: widths[ci], type: WidthType.DXA },
      shading: { fill: ECL.noir, color: "auto", type: "clear" as never },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      borders,
      children: [new Paragraph({ children: inlineRuns(h, { color: ECL.white, size: 19, bold: true }) })],
    })),
  });
  const dataRows = rows.slice(1).map((r, i) => new TableRow({
    children: r.map((c, ci) => {
      const gauge = scoreRuns(c); // jauge visuelle si la cellule est un score
      return new TableCell({
        width: { size: widths[ci] ?? 1500, type: WidthType.DXA },
        shading: { fill: i % 2 ? ECL.ivoire : ECL.white, color: "auto", type: "clear" as never },
        margins: { top: 50, bottom: 50, left: 100, right: 100 },
        borders,
        children: [new Paragraph({
          alignment: gauge || numericCol(ci) ? AlignmentType.CENTER : AlignmentType.LEFT,
          children: gauge ?? inlineRuns(c, { color: numericCol(ci) ? ECL.orDark : ECL.ink, size: 19, bold: numericCol(ci) }),
        })],
      });
    }),
  }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: widths, layout: TableLayoutType.FIXED, rows: [headRow, ...dataRows] });
}

// Rendu .docx du rapport, aux couleurs Éclosion. Interprète le Markdown produit
// par le relecteur : titres (#/##/###), gras (**…**), listes à puces (- …) et
// tableaux (| … |). En-tête et pied maison ; titres de section soulignés d'or.
export async function renderReportDocx(reportTitle: string, body: string, opts: { entete?: boolean } = {}): Promise<Buffer> {
  const entete = opts.entete ?? true;
  // En-tête maison « papier à en-tête » : présent par défaut ; omis (impression
  // « sans en-tête », ex. sur papier pré-imprimé) quand entete = false. Le titre
  // du rapport reste, lui, toujours affiché.
  const children: (Paragraph | Table)[] = entete
    ? [
        new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: "ÉCLOSION ÉDITION", bold: true, size: 30, color: ECL.noir, font: FONT })] }),
        new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: "Direction éditoriale — Service de relecture", size: 18, color: ECL.grey, font: FONT })] }),
        // Filet noir souligné d'or (rappel de la charte).
        new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: ECL.noir, space: 1 } }, spacing: { after: 40 } }),
        new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: ECL.or, space: 1 } }, spacing: { after: 200 } }),
        new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: reportTitle, bold: true, size: 32, color: ECL.noir, font: FONT })] }),
      ]
    : [new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: reportTitle, bold: true, size: 32, color: ECL.noir, font: FONT })] })];

  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].replace(/\s+$/, "");
    if (!line.trim()) { children.push(new Paragraph({ spacing: { after: 40 }, children: [] })); i++; continue; }

    // Tableau Markdown : ligne d'en-tête suivie d'une ligne de séparation ---.
    const isTableSep = i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-");
    if (line.includes("|") && isTableSep) {
      const rows: string[][] = [splitCells(line)];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) { rows.push(splitCells(lines[i])); i++; }
      // Identification / infos document (clé : valeur) → texte compact ; sinon
      // vrai tableau à largeurs fixes.
      if (isKeyValueTable(rows)) { for (const p of keyValueBlock(rows)) children.push(p); }
      else children.push(buildTable(rows));
      children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
      continue;
    }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const txt = h[2].replace(/\*\*/g, "");
      if (level === 1) {
        children.push(new Paragraph({ spacing: { before: 280, after: 90 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ECL.or, space: 3 } }, children: [new TextRun({ text: txt, bold: true, size: 26, color: ECL.noir, font: FONT })] }));
      } else if (level === 2) {
        children.push(new Paragraph({ spacing: { before: 170, after: 50 }, children: [new TextRun({ text: txt, bold: true, size: 22, color: ECL.orDark, font: FONT })] }));
      } else {
        children.push(new Paragraph({ spacing: { before: 130, after: 40 }, children: [new TextRun({ text: txt, bold: true, size: 20, color: ECL.noir, font: FONT })] }));
      }
      i++;
      continue;
    }

    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 30 }, children: inlineRuns(bullet[1], { color: ECL.ink, size: 21 }) }));
      i++;
      continue;
    }

    children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 70 }, children: inlineRuns(line, { color: ECL.ink, size: 21 }) }));
    i++;
  }

  // Pied de page maison.
  children.push(new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 6, color: ECL.line, space: 6 } }, spacing: { before: 260 }, children: [new TextRun({ text: "Ce rapport est un avis argumenté du relecteur d'Éclosion Édition ; il ne constitue pas une décision éditoriale finale.", italics: true, size: 16, color: ECL.grey, font: FONT })] }));

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 21, color: ECL.ink } } } },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}

// Rendu .docx d'un manuscrit corrigé : titre + le texte tel quel, paragraphe
// par paragraphe (pas d'interprétation « markdown »).
async function renderManuscriptDocx(docTitle: string, body: string): Promise<Buffer> {
  const children: Paragraph[] = [new Paragraph({ children: [new TextRun({ text: docTitle, bold: true, size: 26 })] }), new Paragraph({ text: "" })];
  for (const line of body.split("\n")) {
    children.push(new Paragraph({ text: line }));
  }
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

// Découpe un texte en tranches d'au plus maxChars, sur des frontières de
// paragraphe (pour ne pas couper une phrase au milieu). Permet de corriger un
// gros manuscrit chapitre par chapitre sans dépasser les limites de l'API.
function chunkText(text: string, maxChars: number): string[] {
  const paras = text.split(/\n/);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur.length + p.length + 1 > maxChars && cur) {
      chunks.push(cur);
      cur = "";
    }
    // Un paragraphe unique plus long que la tranche : on le coupe brutalement.
    if (p.length > maxChars) {
      for (let i = 0; i < p.length; i += maxChars) chunks.push(p.slice(i, i + maxChars));
      continue;
    }
    cur += (cur ? "\n" : "") + p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export interface AiRunParams {
  manuscriptId: string;
  workType: WorkType;
  editorRecommendation?: string;
  stepCode?: string;
  // Passage BAT pour la relecture de couverture : "BAT1" (1ᵉʳ passage) ou
  // "BAT2" (2ᵉ passage, avec suivi des corrections du BAT précédent).
  coverPass?: "BAT1" | "BAT2";
  // Évaluation : type de manuscrit choisi par le relecteur pour adapter la
  // GRILLE transmise à l'IA. Sinon (absent), on retombe sur le domaine de
  // l'ouvrage. Doit rester cohérent avec le sélecteur de la remise manuelle.
  gridGenreId?: string | null;
  userId: string;
  ip?: string;
}

// Source de la relecture IA selon le PASSAGE du circuit de correction. Le
// circuit va du manuscrit à corriger à la version corrigée finale, en passant
// par la version INTÉGRÉE du 1er passage (rendu de l'intégrateur). On lit donc
// la bonne matière à chaque fois :
//   • BAT1 (correction_1) → « Manuscrit à corriger » (VC1), sinon le manuscrit ;
//   • BAT2 (correction_2) → la VERSION INTÉGRÉE du 1er passage (integration_1),
//     sinon le manuscrit à corriger, sinon le manuscrit — JAMAIS repartir de
//     l'original quand l'intégration du BAT1 existe ;
//   • Couverture          → « Couvertures à corriger » (VC1 : 1ère/dos/4ème),
//     sinon un fichier de couverture, sinon le manuscrit (textes de couverture).
// Les autres travaux (évaluation, expertise, réécriture) lisent le manuscrit.
type AiSourceSpec = { titlePrefix: string } | { category: string };
function aiSourceChain(workType: string): AiSourceSpec[] {
  switch (workType) {
    case "couverture":
      return [{ titlePrefix: "[vc1:couvertures]" }, { category: "couverture" }, { category: "manuscrit" }];
    case "correction_2":
      return [{ titlePrefix: "[correction:integration_1]" }, { titlePrefix: "[vc1:manuscrit]" }, { category: "manuscrit" }];
    case "correction_1":
      return [{ titlePrefix: "[vc1:manuscrit]" }, { category: "manuscrit" }];
    default:
      return [{ category: "manuscrit" }];
  }
}
function noSourceMessage(workType: string): string {
  if (workType === "couverture") return "Aucun fichier de couverture ni manuscrit n'a été déposé pour cet ouvrage.";
  if (workType === "correction_2") return "Aucune version à relire : déposez le manuscrit (ou la version intégrée du 1er passage) avant de lancer la relecture BAT2.";
  return "Aucun fichier manuscrit n'a été déposé pour cet ouvrage.";
}
export async function resolveAiSourceVersion(manuscriptId: string, workType: string) {
  for (const spec of aiSourceChain(workType)) {
    const where = "titlePrefix" in spec
      ? { entityType: "manuscript", entityId: manuscriptId, category: "piece_etape" as never, deletedAt: null, title: { startsWith: spec.titlePrefix } }
      : { entityType: "manuscript", entityId: manuscriptId, category: spec.category as never, deletedAt: null };
    const doc = await prisma.document.findFirst({
      where,
      orderBy: { createdAt: "desc" },
      select: { versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { filePath: true, mimeType: true, versionNumber: true } } },
    });
    if (doc?.versions[0]) return doc.versions[0];
  }
  return undefined;
}

// PRÉ-VOL (rapide, sans appel IA) : valide la configuration et crée le job
// « en cours ». Les erreurs (IA désactivée, pas de clé, manuscrit/fichier/prompt
// manquant) reviennent IMMÉDIATEMENT à l'utilisateur. L'analyse elle-même, qui
// peut être longue, est lancée séparément par executeAiReading — en arrière-plan
// — pour ne pas dépasser le délai de la requête web (cause des erreurs 504).
export async function startAiReading(params: AiRunParams): Promise<{ jobId: string }> {
  const cfg = await loadConfig();
  if (!cfg.enabled) throw new AiRunError("ai_disabled", "L'IA éditoriale est désactivée. Activez-la dans Paramètres.");
  if (!readApiKey(cfg)) throw new AiRunError("no_api_key", "Aucune clé API configurée.");

  const manuscript = await prisma.manuscript.findFirst({ where: { id: params.manuscriptId, deletedAt: null }, select: { id: true } });
  if (!manuscript) throw new AiRunError("not_found", "Manuscrit introuvable.");

  const prompt = await prisma.aiPrompt.findUnique({ where: { workType: params.workType } });
  if (!prompt) throw new AiRunError("no_prompt", "Aucun prompt configuré pour ce type de travail.");

  // Vérifie tout de suite qu'un fichier source existe (requête légère).
  const src = await resolveAiSourceVersion(manuscript.id, params.workType);
  if (!src) throw new AiRunError("no_manuscript_file", noSourceMessage(params.workType));

  const modelId = resolveModelId(cfg.models[params.workType]);
  const job = await prisma.aiReadingJob.create({
    data: {
      manuscriptId: manuscript.id,
      workType: params.workType,
      stepCode: params.stepCode ?? null,
      promptKey: params.workType,
      promptVersion: prompt.version,
      model: modelId,
      editorRecommendation: params.editorRecommendation ?? null,
      status: "en_cours",
      launchedBy: params.userId,
    },
  });
  return { jobId: job.id };
}

// EXÉCUTION (longue) — à lancer en arrière-plan après startAiReading. Ne relance
// JAMAIS d'exception : succès comme échec sont consignés sur le job (que le
// lanceur suit par rafraîchissement). Un PDF de plus de 100 pages (refusé par
// l'API) donne un message clair invitant à déposer un .docx.
export async function executeAiReading(jobId: string, params: AiRunParams): Promise<void> {
  try {
    const cfg = await loadConfig();
    const apiKey = readApiKey(cfg);
    if (!apiKey) throw new AiRunError("no_api_key", "Aucune clé API configurée.");

    const manuscript = await prisma.manuscript.findFirst({
      where: { id: params.manuscriptId, deletedAt: null },
      include: { genre: true, collection: true, workContributors: { include: { partner: true }, orderBy: { displayOrder: "asc" } } },
    });
    if (!manuscript) throw new AiRunError("not_found", "Manuscrit introuvable.");

    const prompt = await prisma.aiPrompt.findUnique({ where: { workType: params.workType } });
    if (!prompt) throw new AiRunError("no_prompt", "Aucun prompt configuré pour ce type de travail.");

    const modelId = resolveModelId(cfg.models[params.workType]);
    const job = { id: jobId };

    // Récupère le fichier source (dernière version déposée) en lisant la BONNE
    // matière selon le passage : BAT1 = manuscrit à corriger ; BAT2 = version
    // INTÉGRÉE du 1er passage ; couverture = couvertures à corriger (cf.
    // resolveAiSourceVersion / aiSourceChain).
    const version = await resolveAiSourceVersion(manuscript.id, params.workType);
    if (!version) {
      throw new AiRunError("no_manuscript_file", noSourceMessage(params.workType));
    }
    const { readStoredFile } = await import("./storage.js");
    const buffer = await readStoredFile(version.filePath);
    // PDF : on tente d'abord d'en EXTRAIRE le texte (permet d'analyser les PDF
    // de plus de 100 pages, refusés par l'IA en pièce jointe). Si le PDF n'a pas
    // de texte exploitable (scanné/image), on retombe sur l'envoi du PDF tel quel.
    let prepared: ManuscriptInput;
    if (isPdfBuffer(version.mimeType, buffer)) {
      const extracted = await extractPdfText(buffer, MANUSCRIT_CHAR_BUDGET);
      if (extracted && extracted.text.replace(/\s/g, "").length > 200) {
        // Le texte extrait est déjà plafonné par extractPdfText (budget) ; il
        // repasse par capManuscriptText plus bas pour la marge finale.
        prepared = { kind: "text", text: extracted.text };
      } else {
        // PDF SANS texte exploitable (scanné/image) : on l'envoie tel quel, mais
        // un PDF-image volumineux ferait exploser la fenêtre de contexte (chaque
        // page ≈ 1 500–2 000 tokens en vision). Au-delà d'un seuil prudent, on
        // refuse PROPREMENT avec un message clair plutôt qu'une erreur brute 400.
        const pages = extracted?.pages ?? Math.ceil(buffer.length / 120_000); // ~120 Ko/page à défaut
        if (pages > 80 || buffer.length > 24 * 1024 * 1024) {
          throw new AiRunError(
            "manuscript_too_large",
            `Ce manuscrit est un PDF « image » (texte non sélectionnable) de ${pages} pages : il est trop volumineux pour l'analyse directe par l'IA. Fournissez une version texte (.docx) ou un PDF dont le texte est sélectionnable, puis relancez.`,
          );
        }
        prepared = { kind: "pdf", base64: buffer.toString("base64") };
      }
    } else {
      prepared = prepareManuscript(version.mimeType, `f${version.versionNumber}`, buffer);
    }

    const author = manuscript.workContributors.find((c) => c.role === "author")?.partner;
    const authorName = author ? `${author.firstName} ${author.lastName}`.trim() : "—";
    const domaine = [manuscript.genre?.label, manuscript.collection?.label].filter(Boolean).join(" / ") || "(non renseigné)";

    const capped = prepared.kind === "text" ? capManuscriptText(prepared.text) : { text: "", truncated: false };
    let userText = fillTemplate(prompt.userTemplate, {
      manuscrit: prepared.kind === "text" ? capped.text : "(le manuscrit est joint en PDF ci-dessous)",
      domaines_collections: await domainesCollectionsText(),
      titre: manuscript.title,
      auteur: authorName,
      domaine,
      recommandation_editeur: params.editorRecommendation?.trim() || "(aucune)",
    });
    if (capped.truncated) {
      userText += "\n\n(Note : le manuscrit est très volumineux ; l'analyse porte sur un EXTRAIT REPRÉSENTATIF — début, passage central et fin. Signale-le clairement dans le rapport et invite à une relecture complète si nécessaire.)";
    }

    // Éléments d'identification à reporter tels quels : la DATE du jour (date à
    // laquelle le rapport est rendu) et le RELECTEUR (Comité de lecture pour une
    // évaluation ; Service de relecture pour une relecture/correction).
    const reportDate = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const relecteur = params.workType === "evaluation" ? "Comité de lecture Éclosion Édition" : "Service de relecture Éclosion Édition";
    userText += `\n\nÀ reporter dans la rubrique d'identification, tels quels : Date du rapport : ${reportDate} ; Relecteur : ${relecteur}.`;

    // Évaluation : on transmet la GRILLE OFFICIELLE (critères + coefficients de la
    // maison) pour que la rubrique C s'y tienne exactement, au lieu que l'IA
    // invente ses propres critères.
    if (params.workType === "evaluation") {
      // Type retenu pour la grille : celui choisi par le relecteur (gridGenreId)
      // sinon le domaine de l'ouvrage. On récupère son libellé pour l'annoncer.
      const gridGenreId = params.gridGenreId ?? manuscript.genreId ?? null;
      let gridGenreLabel = manuscript.genre?.label ?? "—";
      if (params.gridGenreId && params.gridGenreId !== manuscript.genreId) {
        const chosen = await prisma.genre.findFirst({ where: { id: params.gridGenreId, deletedAt: null }, select: { label: true } });
        if (chosen) gridGenreLabel = chosen.label;
      }
      userText += `\n\nGRILLE D'ÉVALUATION OFFICIELLE D'ÉCLOSION (adaptée au type « ${gridGenreLabel} ») — utilise EXACTEMENT ces critères et ces coefficients dans la grille (rubrique C), sans en ajouter ni en retirer, chaque note sur 10 :\n${await evaluationGrilleText(gridGenreId)}`;
    }

    // Passage BAT de la relecture de couverture : on indique explicitement à l'IA
    // s'il s'agit du 1ᵉʳ passage (BAT1) ou du 2ᵉ (BAT2). Au BAT2, on lui JOINT le
    // rapport de couverture du passage précédent pour un suivi fiable des
    // corrections (intégrées / manquantes) et l'appréciation des améliorations.
    if (params.workType === "couverture") {
      const pass = params.coverPass ?? "BAT1";
      if (pass === "BAT1") {
        userText += "\n\n=== PASSAGE : BAT1 (premier passage) ===\nAucun BAT précédent : la rubrique « Suivi des corrections du BAT précédent » doit indiquer « Premier passage — pas de suivi ».";
      } else {
        const prevReport = await findPreviousCoverReportText(manuscript.id, job.id);
        userText += prevReport
          ? "\n\n=== PASSAGE : BAT2 (deuxième passage) ===\nCi-dessous le RAPPORT DE COUVERTURE DU BAT PRÉCÉDENT. Dans la rubrique « Suivi des corrections du BAT précédent », reprends CHAQUE correction qui y était demandée et indique si elle a été intégrée (✔), non intégrée (✘) ou partielle (~), ce qui manque encore, puis apprécie les améliorations apportées.\n\n--- DÉBUT RAPPORT DU BAT PRÉCÉDENT ---\n" + prevReport + "\n--- FIN RAPPORT DU BAT PRÉCÉDENT ---"
          : "\n\n=== PASSAGE : BAT2 (deuxième passage) ===\nLe rapport du BAT précédent est introuvable : signale-le dans la rubrique de suivi et déduis le suivi des corrections encore visibles sur la couverture.";
      }
    }

    const content: Anthropic.MessageParam["content"] =
      prepared.kind === "pdf"
        ? [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: prepared.base64 } },
            { type: "text", text: userText },
          ]
        : userText;

    // Structure imposée : on TRANSMET réellement à l'IA la liste des rubriques du
    // gabarit (reportTemplate.sections). Sans cela, la règle d'or « tu remplis
    // exactement la structure fournie » restait lettre morte — la structure
    // n'était jamais jointe au message, et l'IA improvisait ses titres.
    const tpl = prompt.reportTemplate as { title?: string; sections?: { key: string; title: string }[]; guidance?: string; footer?: string } | null;
    const sections = Array.isArray(tpl?.sections) ? tpl!.sections : [];
    // Consignes de forme PROPRES À CE GABARIT (guidance) : c'est ce qui distingue
    // un rapport d'ÉVALUATION (aucune annotation de correction) d'un rapport de
    // relecture pour correction. À défaut, une règle neutre (tableaux en Markdown).
    const guidance = typeof tpl?.guidance === "string" && tpl.guidance.trim()
      ? tpl.guidance.trim()
      : "Tu rends les grilles de notation en TABLEAUX Markdown (| … |) ; les notes et scores sont chiffrés.";
    const structureBlock = sections.length
      ? `\n\n=== STRUCTURE IMPOSÉE DU RAPPORT « ${String(tpl!.title ?? "RAPPORT")} » ===\n`
        + "Tu produis EXACTEMENT ces rubriques, dans cet ordre, sans en ajouter ni en retirer, en reprenant l'intitulé comme titre de section (niveau « ## » en Markdown, préfixé de sa clé) :\n"
        + sections.map((s) => `## ${s.key}. ${s.title}`).join("\n")
        + `\n\nOBLIGATION DE COMPLÉTUDE : le rapport va de la première à la DERNIÈRE rubrique (${sections[0]?.key ?? "A"} à ${sections[sections.length - 1]?.key ?? "M"}) et TOUTES doivent figurer, dans l'ordre — tu ne sautes JAMAIS une rubrique. Si une rubrique est sans objet, tu l'écris quand même avec la mention « Néant. ». Ne t'arrête pas avant d'avoir rédigé la dernière rubrique (${sections[sections.length - 1]?.key ?? "M"}).`
        + `\n\nRègles de forme : ${guidance} Tout tableau est rendu au format Markdown (| … |).`
        + (tpl!.footer ? `\n\nTermine par ce pied de rapport : ${tpl!.footer}` : "")
      : "";
    const systemPrompt = prompt.systemPrompt + structureBlock;

    const client = new Anthropic({ apiKey });
    const textOf = (blocks: { type: string }[]) =>
      blocks.filter((b) => b.type === "text").map((b) => (b as unknown as { text: string }).text).join("\n").trim();

    const first = await client.messages.create({
      model: modelId,
      max_tokens: REPORT_MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content }],
    });
    let reportText = textOf(first.content);
    // Coût cumulé sur tous les appels (rapport + complétions + éventuelle réécriture).
    let totalInput = first.usage.input_tokens;
    let totalOutput = first.usage.output_tokens;

    // GARANTIE DE COMPLÉTUDE — le rapport doit aller entièrement de la première à
    // la dernière rubrique (ex. A → M), y compris la conclusion (M) rédigée en
    // ENTIER, sans jamais laisser paraître qu'il est généré par IA.
    //
    // (1) CONTINUATION PAR « PRÉFIXE ASSISTANT » : tant que la réponse est tronquée
    // par la limite de tokens, on rappelle l'IA en lui redonnant SON propre texte
    // partiel comme début de réponse — l'API le POURSUIT exactement là où il s'est
    // arrêté. Aucune phrase d'introduction, aucun « méta » (« je confirme que… »)
    // n'est donc possible : c'est la même rédaction qui continue. On finit ainsi
    // les rubriques coupées (dont M) proprement. Bornage à 4 relances.
    const sectionKeys = sections.map((s) => s.key);
    let stop: string | null = first.stop_reason;
    for (let i = 0; i < 4 && stop === "max_tokens"; i++) {
      try {
        const cont = await client.messages.create({
          model: modelId,
          max_tokens: REPORT_MAX_TOKENS,
          system: systemPrompt,
          messages: [
            { role: "user", content },
            { role: "assistant", content: reportText },
          ],
        });
        totalInput += cont.usage.input_tokens;
        totalOutput += cont.usage.output_tokens;
        stop = cont.stop_reason;
        const contText = textOf(cont.content);
        if (!contText) break;
        reportText += contText; // poursuite directe (pas de séparateur : même texte)
      } catch {
        break; // une relance qui échoue ne doit pas faire échouer tout le job
      }
    }

    // (2) FILET DE SÉCURITÉ : si une rubrique manque encore (le modèle a « terminé »
    // sans la rédiger), on la réclame explicitement — en ne conservant que le texte
    // À PARTIR de la 1ʳᵉ rubrique demandée (tout préambule/« méta » est écarté).
    for (let guard = 0; guard < 2 && sectionKeys.length > 0; guard++) {
      const missing = missingSectionKeys(reportText, sectionKeys);
      if (missing.length === 0) break;
      try {
        const cont = await client.messages.create({
          model: modelId,
          max_tokens: REPORT_MAX_TOKENS,
          system: systemPrompt,
          messages: [
            { role: "user", content: "Tu rédiges le rapport ci-dessous, selon la structure imposée déjà transmise." },
            { role: "assistant", content: reportText },
            {
              role: "user",
              content:
                `Il manque la/les rubrique(s) ${missing.map((k) => `« ${k} »`).join(", ")}. `
                + "Réponds UNIQUEMENT avec le contenu de ces rubriques, en COMMENÇANT DIRECTEMENT par « ## clé. titre », dans l'ordre. "
                + "AUCUNE phrase d'introduction, AUCUN commentaire, ne confirme rien, n'évoque JAMAIS ce message, une vérification ou une intelligence artificielle. "
                + "Ne répète pas les rubriques déjà rédigées ; « Néant. » si une rubrique est sans objet.",
            },
          ],
        });
        totalInput += cont.usage.input_tokens;
        totalOutput += cont.usage.output_tokens;
        let contText = textOf(cont.content);
        const idx = firstSectionHeadingIndex(contText, missing);
        if (idx < 0) break;
        contText = contText.slice(idx).trim();
        if (!contText) break;
        reportText = `${reportText}\n\n${contText}`;
      } catch {
        break;
      }
    }
    if (!reportText) reportText = "Le relecteur n'a produit aucun texte.";

    const price = PRICES[modelId] ?? PRICES["claude-haiku-4-5"];

    const reportTitle = String((prompt.reportTemplate as { title?: string })?.title ?? "RAPPORT");
    const title = `${prompt.label} — ${manuscript.title}`;
    // Classement dans la GED : le rapport d'évaluation est un « rapport de
    // lecture » ; les relectures de correction/couverture sont des pièces
    // rattachées à leur étape.
    const category = params.workType === "evaluation" ? "rapport_lecture" : "piece_etape";
    const docxBuffer = await renderReportDocx(reportTitle, reportText);
    const stored = await storeFile(docxBuffer, `${params.workType}_${manuscript.manuscriptNumber}.docx`);

    const created = await prisma.document.create({
      data: {
        entityType: "manuscript",
        entityId: manuscript.id,
        category,
        title,
        createdBy: params.userId,
        versions: {
          create: {
            versionNumber: 1,
            filePath: stored.filePath,
            fileSize: stored.fileSize,
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sha256Hash: stored.sha256Hash,
            status: "draft",
            changeSummary: "Généré par le service de relecture Éclosion.",
            uploadedBy: params.userId,
          },
        },
      },
    });

    const producedIds: string[] = [created.id];
    // Comparaison avant/après (réécriture) : on conserve le texte source analysé
    // et le texte réécrit proposé pour l'afficher côte à côte.
    let comparisonSource: string | null = null;
    let comparisonRewrite: string | null = null;

    // Régénération du manuscrit corrigé (Lot IA-3b) — uniquement 1ʳᵉ/2ᵉ
    // correction et si le texte est exploitable (pas un PDF image). Le livre est
    // corrigé PAR TRANCHES pour tenir sur les gros volumes. L'IA renvoie le texte
    // corrigé seul ; le correcteur reste maître de l'intégration.
    if ((params.workType === "correction_1" || params.workType === "correction_2" || params.workType === "reecriture") && prepared.kind === "text" && prepared.text.trim()) {
      const isReecriture = params.workType === "reecriture";
      const versionLabel = params.workType === "correction_1" ? "BAT1" : params.workType === "correction_2" ? "BAT2" : "REECRITURE";
      const rewriteSystem = isReecriture
        ? "Tu es le réécriveur du Service de relecture d'Éclosion Édition. On te confie un passage de manuscrit à RÉÉCRIRE : améliore la fluidité, la clarté, la précision et le vocabulaire, supprime les lourdeurs et les répétitions, soigne les transitions et la logique — TOUT EN PRÉSERVANT LA VOIX DE L'AUTEUR (son ton, son rythme, son vocabulaire caractéristique). Renvoie UNIQUEMENT le texte réécrit, sans aucun commentaire, sans balise, sans note. Conserve le sens, la mise en paragraphes et la structure. Tu ne mentionnes jamais que tu es une intelligence artificielle."
        : "Tu es le correcteur du Service de relecture d'Éclosion Édition. On te confie un passage de manuscrit. Renvoie UNIQUEMENT le texte corrigé (orthographe, grammaire, syntaxe, ponctuation, typographie, répétitions), sans aucun commentaire, sans balise, sans note. Conserve strictement le sens, le style de l'auteur, la mise en paragraphes et la structure. Tu ne mentionnes jamais que tu es une intelligence artificielle.";
      const recoPrefix = params.editorRecommendation?.trim() ? `Consigne particulière de l'éditeur : ${params.editorRecommendation.trim()}\n\n` : "";
      // Tranches assez petites pour que le texte corrigé tienne SOUS la limite de
      // sortie du modèle (8192 pour Haiku) : ~8000 caractères ≈ 2500 tokens, le
      // corrigé reste bien en deçà de max_tokens. Un max_tokens trop élevé serait
      // rejeté par l'API (400) et ferait échouer toute la correction.
      const chunks = chunkText(prepared.text, 8000);
      const correctedParts: string[] = [];
      for (const ch of chunks) {
        const cr = await client.messages.create({
          model: modelId,
          max_tokens: REPORT_MAX_TOKENS,
          system: rewriteSystem,
          messages: [{ role: "user", content: recoPrefix + ch }],
        });
        totalInput += cr.usage.input_tokens;
        totalOutput += cr.usage.output_tokens;
        correctedParts.push(cr.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(""));
      }
      const correctedText = correctedParts.join("\n");
      const docLabel = isReecriture ? "Version réécrite" : "Manuscrit corrigé";
      const fileStem = isReecriture ? "manuscrit_reecrit" : "manuscrit_corrige";
      const correctedDocx = await renderManuscriptDocx(`${docLabel} (${versionLabel}) — ${manuscript.title}`, correctedText);
      const storedC = await storeFile(correctedDocx, `${fileStem}_${versionLabel}_${manuscript.manuscriptNumber}.docx`);
      const correctedDoc = await prisma.document.create({
        data: {
          entityType: "manuscript",
          entityId: manuscript.id,
          category: "piece_etape",
          // Règle permanente : un document LIVRÉ ne mentionne jamais qu'il a été
          // produit par l'IA (pas de « (IA) » dans le titre). Le passage BAT
          // (BAT1/BAT2) suffit à l'identifier.
          title: `${docLabel} — ${versionLabel}`,
          createdBy: params.userId,
          versions: {
            create: {
              versionNumber: 1,
              filePath: storedC.filePath,
              fileSize: storedC.fileSize,
              mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              sha256Hash: storedC.sha256Hash,
              status: "draft",
              changeSummary: isReecriture
                ? "Version réécrite générée par le service de relecture Éclosion (proposition à valider, la voix de l'auteur est préservée)."
                : `Manuscrit corrigé ${versionLabel} généré par le service de relecture Éclosion (à intégrer par le correcteur).`,
              uploadedBy: params.userId,
            },
          },
        },
      });
      producedIds.push(correctedDoc.id);
      if (isReecriture) {
        comparisonSource = prepared.text;
        comparisonRewrite = correctedText;
      }
    }

    const costUsd = (totalInput * price.in + totalOutput * price.out) / 1_000_000;
    const costEstimate = Math.round(costUsd * 600 * 100) / 100; // ≈ FCFA (1 USD ≈ 600 XAF)

    await prisma.aiReadingJob.update({
      where: { id: job.id },
      data: { status: "termine", finishedAt: new Date(), producedDocumentIds: producedIds, reportVersion: 1, costEstimate, reportText, sourceText: comparisonSource, rewriteText: comparisonRewrite },
    });
    await writeAuditLog({
      userId: params.userId,
      action: "create",
      entityType: "ai_reading_job",
      entityId: job.id,
      newValues: { workType: params.workType, manuscriptId: manuscript.id, documentId: created.id, model: modelId, costEstimate },
      ipAddress: params.ip ?? null,
    });
  } catch (e) {
    let message = e instanceof Error ? e.message : "Échec de la relecture IA.";
    // Message clair pour la limite PDF de l'API (100 pages) : orienter vers .docx.
    if (/100 PDF pages/i.test(message)) {
      message = "Le manuscrit PDF dépasse 100 pages, refusé par l'IA. Déposez le manuscrit au format Word (.docx) : il sera analysé intégralement.";
    }
    await prisma.aiReadingJob.update({ where: { id: jobId }, data: { status: "erreur", finishedAt: new Date(), errorMessage: message } }).catch(() => {});
  }
}
