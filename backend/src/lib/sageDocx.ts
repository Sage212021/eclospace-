import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  HeadingLevel,
  TableLayoutType,
} from "docx";

// Export Word (.docx) d'un document rédigé par le Service éditorial (dialogue
// DG — SAGE). Le fichier se lit comme un travail livré de main d'homme : AUCUNE
// mention d'« IA », aucun nom d'outil, signé « Le Service éditorial — Éditions
// Éclosion » (règle d'or des documents LIVRÉS, CLAUDE.md §9). Rendu
// « markdown-léger » (titres #/##/###, listes, tableaux, gras, filets) via la
// bibliothèque `docx` déjà présente (pas de dépendance nouvelle). Équivalent
// Word du PDF `frontend/src/lib/sageAnswerPdf.ts` : même en-tête, même structure.

const OR = "C89E2A";
const OR_DARK = "9A7A12";
const NOIR = "0B0B0C";
const GRIS = "606060";
const LINE = "E1DED4";
const FONT = "Calibri";

const HOUSE = {
  name: "ECLOSION EDITION SARL",
  address: "Carrefour INSTIC – Nouvelle route Kondengui, Yaoundé, Cameroun",
  poBox: "B.P. 33071 Yaoundé",
  phone: "(+237) 654 366 663 / 698 03 15 02 / 678 70 40 86",
  email: "eclosionedition@gmail.com",
  website: "https://www.eclosion.cm",
};

// Nettoie les marqueurs markdown d'une ligne (gras, italique, code, titres).
function clean(line: string): string {
  return line
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|\s)\*([^*\s][^*]*?)\*(?=\s|$)/g, "$1$2")
    .replace(/\s+$/g, "");
}

// Fragmente une ligne en TextRun gras/normaux selon **gras** (markdown).
function inlineRuns(text: string, opts: { bold?: boolean; size?: number; color?: string } = {}): TextRun[] {
  const size = opts.size ?? 21; // demi-points : 21 ≈ 10.5pt
  const color = opts.color ?? NOIR;
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((s) => s !== "");
  const runs: TextRun[] = [];
  for (const p of parts) {
    const m = /^\*\*([^*]+)\*\*$/.exec(p);
    runs.push(new TextRun({ text: m ? m[1] : clean(p), bold: opts.bold || Boolean(m), color, size, font: FONT }));
  }
  return runs.length ? runs : [new TextRun({ text: "", size, color, font: FONT })];
}

function tableFrom(rows: string[][]): Table {
  const border = { style: BorderStyle.SINGLE, size: 2, color: LINE };
  const header = rows[0] ?? [];
  const headRow = new TableRow({
    tableHeader: true,
    children: header.map((h) => new TableCell({
      margins: { top: 60, bottom: 60, left: 90, right: 90 },
      shading: { fill: NOIR, color: "auto", type: "clear" as never },
      children: [new Paragraph({ children: inlineRuns(h, { color: "FFFFFF", size: 19, bold: true }) })],
    })),
  });
  const bodyRows = rows.slice(1).map((r, i) => new TableRow({
    children: header.map((_, ci) => new TableCell({
      margins: { top: 50, bottom: 50, left: 90, right: 90 },
      shading: i % 2 === 1 ? { fill: "FAF8F2", color: "auto", type: "clear" as never } : undefined,
      children: [new Paragraph({ children: inlineRuns((r[ci] ?? "").trim(), { size: 19 }) })],
    })),
  }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.AUTOFIT,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [headRow, ...bodyRows],
  });
}

// Construit le corps « markdown-léger » en blocs docx (paragraphes et tableaux).
function bodyChildren(markdown: string, skipFirstH1: string | null): (Paragraph | Table)[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: (Paragraph | Table)[] = [];
  let skipped = false;
  let tableBuf: string[][] | null = null;

  const flushTable = () => {
    if (tableBuf && tableBuf.length) out.push(tableFrom(tableBuf));
    tableBuf = null;
  };

  for (const raw of lines) {
    const t = raw.trim();
    if (skipFirstH1 && !skipped && raw === skipFirstH1) { skipped = true; continue; }

    // Lignes de tableau markdown : on les accumule puis on construit un vrai tableau.
    if (/^\|.*\|$/.test(t)) {
      if (/^\|[\s:|-]+\|$/.test(t)) continue; // séparateur |---|
      const cells = t.replace(/^\||\|$/g, "").split("|").map((c) => clean(c.trim()));
      (tableBuf ??= []).push(cells);
      continue;
    }
    flushTable();

    if (t === "") { out.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: "", font: FONT })] })); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 1 } }, spacing: { after: 120 }, children: [] }));
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) {
      const level = h[1].length;
      out.push(new Paragraph({
        heading: level <= 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        spacing: { before: level <= 2 ? 200 : 120, after: 80 },
        children: inlineRuns(clean(h[2]), { bold: true, color: NOIR, size: level <= 1 ? 28 : level === 2 ? 25 : 23 }),
      }));
      continue;
    }

    const b = /^([-*•])\s+(.*)$/.exec(t);
    if (b) {
      out.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: inlineRuns(b[2]) }));
      continue;
    }

    const num = /^(\d+)[.)]\s+(.*)$/.exec(t);
    if (num) {
      out.push(new Paragraph({ spacing: { after: 40 }, indent: { left: 360, hanging: 360 }, children: inlineRuns(`${num[1]}. ${num[2]}`) }));
      continue;
    }

    out.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 120, line: 276 }, children: inlineRuns(raw) }));
  }
  flushTable();
  return out;
}

export interface SageDocxOptions {
  title?: string;
  dateIso?: string;
}

// Rend un document markdown en .docx (Buffer). `title` par défaut : 1ʳᵉ ligne
// « # … » si présente, sinon un libellé générique.
export async function buildSageDocx(content: string, opts: SageDocxOptions = {}): Promise<Buffer> {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const firstH1 = lines.find((l) => /^#\s+\S/.test(l.trim())) ?? null;
  const titleFromH1 = firstH1 ? clean(firstH1.replace(/^#\s+/, "")) : "";
  const title = opts.title || titleFromH1 || "Note du Service éditorial";
  const date = new Date(opts.dateIso || Date.now()).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

  const header: Paragraph[] = [
    new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: HOUSE.name, bold: true, size: 20, color: NOIR, font: FONT })] }),
    new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: `${HOUSE.address} · ${HOUSE.poBox}`, size: 15, color: GRIS, font: FONT })] }),
    new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: `Tél. ${HOUSE.phone} · ${HOUSE.email} · ${HOUSE.website}`, size: 15, color: GRIS, font: FONT })] }),
    new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: OR, space: 1 } }, spacing: { after: 160 }, children: [] }),
    new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: title, bold: true, size: 32, color: NOIR, font: FONT })] }),
    new Paragraph({ spacing: { after: 220 }, children: [new TextRun({ text: `Service éditorial — Éditions Éclosion · ${date}`, size: 19, color: GRIS, font: FONT })] }),
  ];

  const body = bodyChildren(content, firstH1);

  const signature: Paragraph[] = [
    new Paragraph({ spacing: { before: 280, after: 40 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: OR, space: 1 } }, children: [] }),
    new Paragraph({ children: [new TextRun({ text: "Le Service éditorial — Éditions Éclosion", bold: true, size: 21, color: NOIR, font: FONT })] }),
  ];

  const doc = new Document({
    creator: "Éditions Éclosion",
    title,
    styles: {
      default: { document: { run: { font: FONT, size: 21, color: NOIR } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { bold: true, size: 28, color: NOIR, font: FONT } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { bold: true, size: 25, color: OR_DARK, font: FONT } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", run: { bold: true, size: 23, color: NOIR, font: FONT } },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
      children: [...header, ...body, ...signature],
    }],
  });

  return Packer.toBuffer(doc);
}
