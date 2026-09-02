import { jsPDF } from "jspdf";
import { ECLOSION_LOGO_PNG, ECLOSION_LOGO_RATIO } from "./payslipAssets";
import { HOUSE } from "./print";
import type { InvoiceDetail, EditorialQuote } from "../api/client";

// ─────────────────────────────────────────────────────────────────────────────
// Génération de PDF VECTORIELS (jsPDF) pour les documents Finance & commercial.
// Objectif : un rendu net sur TOUT appareil, téléphone compris — le texte, les
// tableaux et le logo restent vectoriels et ne sont jamais rasterisés (contrai-
// rement à « Imprimer → PDF » d'un navigateur mobile, qui aplatit la page en
// image). Reprend l'identité « Noir souverain » : or #D9B21A, noir #0B0B0C.
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_W = 210;
const PAGE_H = 297;
const L = 16; // marge gauche
const R = PAGE_W - 16; // bord droit
const CONTENT_W = R - L;

const INK: [number, number, number] = [11, 11, 12];
const GOLD: [number, number, number] = [217, 178, 26];
const GOLD_DARK: [number, number, number] = [154, 122, 18];
const MUTED: [number, number, number] = [107, 114, 128];
const LINE: [number, number, number] = [231, 226, 212];
const ZEBRA: [number, number, number] = [250, 248, 242];
const WHITE: [number, number, number] = [255, 255, 255];

function money(value: string | number, currency: string): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency || "XAF", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${n.toLocaleString("fr-FR")} ${currency}`;
  }
}

// En-tête maison : logo (pleine résolution) à gauche, coordonnées à droite,
// filet or/noir. Renvoie la position verticale sous l'en-tête.
function houseHeader(doc: jsPDF): number {
  const logoW = 46;
  const logoH = logoW / ECLOSION_LOGO_RATIO;
  const top = 14;
  try {
    doc.addImage(ECLOSION_LOGO_PNG, "PNG", L, top, logoW, logoH, "eclLogoFin", "SLOW");
  } catch {
    /* logo indisponible : on continue sans */
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  doc.setTextColor(...MUTED);
  const lines = [
    HOUSE.address,
    HOUSE.poBox,
    `Tél ${HOUSE.phone}`,
    HOUSE.email,
    HOUSE.website.replace(/^https?:\/\//, ""),
    `RC ${HOUSE.rccm} · NIU ${HOUSE.niu}`,
  ];
  let cy = top + 2;
  for (const ln of lines) {
    const wrapped = doc.splitTextToSize(ln, 78) as string[];
    for (const w of wrapped) {
      doc.text(w, R, cy, { align: "right" });
      cy += 3.4;
    }
  }

  const y = Math.max(top + logoH, cy) + 3;
  // Filet noir (62 %) + or (38 %).
  doc.setFillColor(...INK);
  doc.rect(L, y, CONTENT_W * 0.62, 0.9, "F");
  doc.setFillColor(...GOLD);
  doc.rect(L + CONTENT_W * 0.62, y, CONTENT_W * 0.38, 0.9, "F");
  return y + 8;
}

function footer(doc: jsPDF): void {
  const y = PAGE_H - 15;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.2);
  doc.line(L, y, R, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  const legal = `${HOUSE.legalName} — ${HOUSE.tagline}. ${HOUSE.address}, ${HOUSE.poBox}. RC ${HOUSE.rccm} · NIU ${HOUSE.niu} · CNPS ${HOUSE.cnps}.`;
  const wrapped = doc.splitTextToSize(legal, CONTENT_W) as string[];
  let cy = y + 4;
  for (const w of wrapped) {
    doc.text(w, L, cy);
    cy += 3;
  }
}

interface Column {
  label: string;
  width: number; // mm
  align: "left" | "right";
}
interface TotalRow {
  label: string;
  value: string;
  strong?: boolean;
}
interface HouseDocSpec {
  docName: string;
  fileName: string;
  number: string;
  meta: { label: string; value: string }[];
  badge?: string;
  partyLabel: string;
  partyName: string;
  partyExtra?: string[];
  columns: Column[];
  rows: string[][]; // aligné sur columns
  totals: TotalRow[];
  notes?: string[];
  signatureFor?: string; // ex. HOUSE.legalName
  watermark?: string; // ex. « Duplicata »
}

// Filigrane diagonal discret (ex. « Duplicata »).
function watermark(doc: jsPDF, text: string): void {
  doc.saveGraphicsState();
  // @ts-expect-error GState fourni à l'exécution par jsPDF.
  doc.setGState(new doc.GState({ opacity: 0.06 }));
  doc.setFont("courier", "normal");
  doc.setFontSize(60);
  doc.setTextColor(120, 120, 130);
  doc.text(text, PAGE_W / 2, PAGE_H / 2, { align: "center", angle: 30 });
  doc.restoreGraphicsState();
}

// Rendu générique d'un document « à lignes + totaux » (facture, avoir, devis,
// bon de commande). Gère le saut de page en répétant l'en-tête du tableau.
function renderHouseDoc(spec: HouseDocSpec): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  if (spec.watermark) watermark(doc, spec.watermark);
  let y = houseHeader(doc);

  // Titre.
  doc.setFont("times", "bold");
  doc.setFontSize(19);
  doc.setTextColor(...INK);
  doc.text(spec.docName, L, y);
  y += 7;

  // Ligne méta (N°, dates, badge).
  doc.setFontSize(9.5);
  let mx = L;
  const metaAll = [{ label: "N°", value: spec.number }, ...spec.meta];
  for (const m of metaAll) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(`${m.label} `, mx, y);
    const lw = doc.getTextWidth(`${m.label} `);
    doc.setFont("courier", "bold");
    doc.setTextColor(...INK);
    doc.text(m.value, mx + lw, y);
    mx += lw + doc.getTextWidth(m.value) + 7;
  }
  if (spec.badge) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...GOLD_DARK);
    doc.text(spec.badge.toUpperCase(), R, y, { align: "right" });
  }
  y += 8;

  // Partie (destinataire).
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(spec.partyLabel.toUpperCase(), L, y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text(spec.partyName, L, y);
  y += 5;
  if (spec.partyExtra?.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    for (const ex of spec.partyExtra) {
      doc.text(ex, L, y);
      y += 4.2;
    }
  }
  y += 4;

  // Tableau des lignes.
  const drawTableHeader = (): number => {
    doc.setFillColor(...INK);
    doc.rect(L, y, CONTENT_W, 7, "F");
    doc.setFillColor(...GOLD);
    doc.rect(L, y + 7, CONTENT_W, 0.8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...WHITE);
    let cx = L;
    for (const c of spec.columns) {
      if (c.align === "right") doc.text(c.label, cx + c.width - 2, y + 4.8, { align: "right" });
      else doc.text(c.label, cx + 2, y + 4.8);
      cx += c.width;
    }
    return y + 7.8 + 1;
  };
  y = drawTableHeader();

  doc.setFontSize(9);
  let even = false;
  for (const row of spec.rows) {
    // Hauteur de la ligne : la 1re colonne (description) peut être multi-lignes.
    const descLines = doc.splitTextToSize(row[0], spec.columns[0].width - 4) as string[];
    const rowH = Math.max(7, descLines.length * 4.2 + 3);
    if (y + rowH > PAGE_H - 24) {
      footer(doc);
      doc.addPage();
      y = houseHeader(doc);
      y = drawTableHeader();
    }
    if (even) {
      doc.setFillColor(...ZEBRA);
      doc.rect(L, y, CONTENT_W, rowH, "F");
    }
    let cx = L;
    for (let i = 0; i < spec.columns.length; i++) {
      const c = spec.columns[i];
      doc.setTextColor(...INK);
      if (i === 0) {
        doc.setFont("helvetica", "normal");
        doc.text(descLines, cx + 2, y + 4.6);
      } else {
        doc.setFont("courier", "normal");
        doc.setFontSize(8.6);
        if (c.align === "right") doc.text(row[i], cx + c.width - 2, y + 4.6, { align: "right" });
        else doc.text(row[i], cx + 2, y + 4.6);
        doc.setFontSize(9);
      }
      cx += c.width;
    }
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(L, y + rowH, R, y + rowH);
    y += rowH;
    even = !even;
  }
  y += 8;

  // Totaux (bloc aligné à droite).
  const tW = 82;
  const tX = R - tW;
  if (y > PAGE_H - 60) {
    footer(doc);
    doc.addPage();
    y = houseHeader(doc);
  }
  for (const t of spec.totals) {
    if (t.strong) {
      doc.setDrawColor(...GOLD);
      doc.setLineWidth(0.6);
      doc.line(tX, y, R, y);
      y += 5;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(...INK);
      doc.text(t.label, tX, y);
      doc.setFont("courier", "bold");
      doc.setTextColor(...GOLD_DARK);
      doc.text(t.value, R, y, { align: "right" });
      y += 6;
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);
      doc.text(t.label, tX, y);
      doc.setFont("courier", "normal");
      doc.text(t.value, R, y, { align: "right" });
      y += 5.2;
    }
  }
  y += 4;

  // Notes (mentions, exclusions…).
  if (spec.notes?.length) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    for (const note of spec.notes) {
      const wrapped = doc.splitTextToSize(note, CONTENT_W) as string[];
      if (y + wrapped.length * 4 > PAGE_H - 40) {
        footer(doc);
        doc.addPage();
        y = houseHeader(doc);
      }
      for (const w of wrapped) {
        doc.text(w, L, y);
        y += 4;
      }
      y += 2;
    }
  }

  // Zone de signature maison.
  if (spec.signatureFor) {
    if (y < PAGE_H - 55) y = Math.max(y + 8, PAGE_H - 55);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`POUR ${spec.signatureFor.toUpperCase()}`, R - 76, y);
    y += 4.5;
    doc.text("Le responsable — signature & cachet", R - 76, y);
    y += 20;
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.3);
    doc.line(R - 76, y, R, y);
    y += 4;
    doc.text("Nom, date et signature", R - 76, y);
  }

  footer(doc);
  return doc;
}

// ── Facture / Avoir / Proforma ───────────────────────────────────────────────
export function invoicePdf(invoice: InvoiceDetail): jsPDF {
  const isCredit = invoice.type === "credit_note";
  const isProforma = invoice.type === "proforma";
  const cur = invoice.currency || "XAF";
  const docName = isCredit ? "Avoir" : isProforma ? "Facture proforma" : "Facture";
  const isDuplicate = invoice.type === "invoice" && !!invoice.printedAt;

  const columns: Column[] = [
    { label: "Description", width: 78, align: "left" },
    { label: "Qté", width: 18, align: "right" },
    { label: "P.U. HT", width: 34, align: "right" },
    { label: "TVA", width: 18, align: "right" },
    { label: "Total HT", width: CONTENT_W - 78 - 18 - 34 - 18, align: "right" },
  ];
  const rows = invoice.lines.map((l) => [l.description, String(l.quantity), money(l.unitPrice, cur), `${Number(l.taxRate)} %`, money(l.lineTotal, cur)]);

  const d = Number(invoice.discountPct ?? 0);
  let totals: TotalRow[];
  if (d > 0) {
    const grossHt = invoice.lines.reduce((s, l) => s + Number(l.lineTotal), 0);
    const grossTax = invoice.lines.reduce((s, l) => s + Number(l.lineTotal) * (Number(l.taxRate) / 100), 0);
    const grossTtc = grossHt + grossTax;
    const remise = Math.round((grossTtc - Number(invoice.totalTtc)) * 100) / 100;
    totals = [
      { label: "Total", value: money(grossTtc, cur) },
      { label: `Remise ${d.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`, value: `− ${money(remise, cur)}` },
      { label: "Net à payer", value: money(invoice.totalTtc, cur), strong: true },
    ];
  } else {
    totals = [
      { label: "Total HT", value: money(invoice.totalHt, cur) },
      { label: "TVA", value: money(invoice.totalTax, cur) },
      { label: "Total TTC", value: money(invoice.totalTtc, cur), strong: true },
    ];
  }

  const notes: string[] = [];
  if (isDuplicate) notes.push(`Duplicata — copie conforme d'une facture déjà imprimée${invoice.printedAt ? ` (original tiré le ${new Date(invoice.printedAt).toLocaleDateString("fr-FR")})` : ""}.`);
  if (!isCredit && !isProforma && invoice.status === "issued") {
    notes.push(`VENTE À CRÉDIT — montant dû, à régler${invoice.dueDate ? ` avant le ${new Date(invoice.dueDate).toLocaleDateString("fr-FR")}` : ""}.`);
  }

  return renderHouseDoc({
    docName: docName + (isDuplicate ? "  (duplicata)" : ""),
    fileName: `${docName} ${invoice.invoiceNumber}`,
    number: invoice.invoiceNumber,
    meta: [
      { label: "Émise le", value: invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString("fr-FR") : "—" },
      { label: "Échéance", value: invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString("fr-FR") : "—" },
    ],
    partyLabel: isCredit ? "Avoir au profit de" : "Facturé à",
    partyName: invoice.customer.name,
    columns,
    rows,
    totals,
    notes,
    signatureFor: HOUSE.legalName,
    watermark: isDuplicate ? "Duplicata" : undefined,
  });
}

export function downloadInvoicePdf(invoice: InvoiceDetail): void {
  const name = invoice.type === "credit_note" ? "Avoir" : invoice.type === "proforma" ? "Proforma" : "Facture";
  invoicePdf(invoice).save(`${name}-${invoice.invoiceNumber}.pdf`);
}

// ── Devis de prestation ──────────────────────────────────────────────────────
const QUOTE_TITLES: Record<string, string> = {
  editorial: "Devis de prestation éditoriale",
  impression: "Devis d'impression",
  communication: "Devis de communication",
};
const QUOTE_METHOD: Record<string, string> = {
  online_link: "en ligne",
  internal: "enregistrée par la maison",
  paper: "sur devis papier signé",
};

export function editorialQuotePdf(quote: EditorialQuote): jsPDF {
  const cur = quote.currency || "XAF";
  const author = quote.partner ? `${quote.partner.firstName} ${quote.partner.lastName}` : quote.customer?.name ?? "";
  const columns: Column[] = [
    { label: "Prestation", width: 78, align: "left" },
    { label: "Qté", width: 18, align: "right" },
    { label: "P.U. HT", width: 34, align: "right" },
    { label: "TVA", width: 18, align: "right" },
    { label: "Total HT", width: CONTENT_W - 78 - 18 - 34 - 18, align: "right" },
  ];
  const rows = quote.lines.map((l) => [l.description, String(l.quantity), money(l.unitPrice, cur), `${Number(l.taxRate)} %`, money(l.lineTotal, cur)]);

  const notes: string[] = [];
  if (quote.exclusionsNote) notes.push(quote.exclusionsNote);
  const partyExtra: string[] = [];
  if (quote.manuscript) partyExtra.push(`Ouvrage : ${quote.manuscript.title}`);
  if (quote.acceptedAt && quote.signerName) {
    notes.push(`Devis accepté et signé par ${quote.signerName}, le ${new Date(quote.acceptedAt).toLocaleDateString("fr-FR")}${quote.acceptanceMethod ? ` · signature ${QUOTE_METHOD[quote.acceptanceMethod] ?? quote.acceptanceMethod}` : ""}.`);
  }

  return renderHouseDoc({
    docName: QUOTE_TITLES[quote.serviceType] ?? "Devis de prestation",
    fileName: `Devis ${quote.quoteNumber}`,
    number: quote.quoteNumber,
    meta: quote.validUntil ? [{ label: "Valable jusqu'au", value: new Date(quote.validUntil).toLocaleDateString("fr-FR") }] : [],
    partyLabel: "Établi pour",
    partyName: author,
    partyExtra,
    columns,
    rows,
    totals: [
      { label: "Total HT", value: money(quote.totalHt, cur) },
      { label: "TVA", value: money(quote.totalTax, cur) },
      { label: "Total TTC", value: money(quote.totalTtc, cur), strong: true },
    ],
    notes,
    signatureFor: HOUSE.legalName,
  });
}

export function downloadEditorialQuotePdf(quote: EditorialQuote): void {
  editorialQuotePdf(quote).save(`Devis-${quote.quoteNumber}.pdf`);
}
