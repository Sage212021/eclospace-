import { jsPDF } from "jspdf";
import { ECLOSION_LOGO_PNG, ECLOSION_LOGO_RATIO } from "./payslipAssets";
import { drawWatermark } from "./pdfWatermark";
import { HOUSE, type AuthorRoyaltyStatementData, type CommissionStatementData, type TreasuryBalancePrintData, type TreasuryStatementData, type ContractStampData } from "./print";
import type { InvoiceDetail, EditorialQuote, PurchaseOrder, RoyaltyStatementDetail } from "../api/client";
import { purchaseOrderExtras } from "../api/client";

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

// Les polices standard de jsPDF (Helvetica/WinAnsi) ne savent pas afficher
// l'espace fine insécable (U+202F) ni l'espace insécable (U+00A0) que le format
// français utilise comme séparateur de milliers et avant le symbole monétaire —
// elles apparaissaient comme une barre « / » (« 5 / 686 / 250 »). On les remplace
// donc par une espace ASCII ordinaire pour un rendu propre dans le PDF.
function pdfSafeSpaces(s: string): string {
  return s.replace(/[  ]/g, " ");
}
function money(value: string | number, currency: string): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  try {
    return pdfSafeSpaces(new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency || "XAF", maximumFractionDigits: 0 }).format(n));
  } catch {
    return `${pdfSafeSpaces(n.toLocaleString("fr-FR"))} ${currency}`;
  }
}

// En-tête maison : logo (pleine résolution) à gauche, coordonnées à droite,
// filet or/noir. Renvoie la position verticale sous l'en-tête.
function houseHeader(doc: jsPDF): number {
  drawWatermark(doc);
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

  // Mention centrale officielle (identité + métiers), reprise du papier à en-tête
  // physique et des documents imprimés (HTML) — pour que le PDF téléchargé/transféré
  // ait EXACTEMENT le même en-tête à bandeau que la version imprimée.
  const cx = (L + R) / 2;
  let by = Math.max(top + logoH, cy) + 4;
  doc.setFont("times", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(...INK);
  doc.text("Éclosion Édition Sarl", cx, by, { align: "center" });
  by += 4.4;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED);
  let svcSize = 7.4;
  doc.setFontSize(svcSize);
  const svc = "Édition du livre   |   Conception et réalisation des supports de communication   |   Imprimerie offset et numérique";
  const svcW = doc.getTextWidth(svc);
  if (svcW > CONTENT_W) { svcSize = svcSize * (CONTENT_W / svcW) * 0.98; doc.setFontSize(svcSize); }
  doc.text(svc, cx, by, { align: "center" });
  by += 3;

  const y = by + 1;
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
  // Bloc de totaux secondaire (ex. récapitulatif fiscal de l'état annuel).
  secondaryTitle?: string;
  secondaryTotals?: TotalRow[];
  // Tableau secondaire à deux colonnes (libellé | valeur), ex. « Fiche technique »
  // du bon de commande — rendu entre le tableau principal et les lignes d'info,
  // pour un PDF fidèle à la version imprimée (HTML).
  specTable?: { title: string; rows: [string, string][] };
  // Lignes d'information sous le tableau (ex. consignes, lieu de livraison).
  infoLines?: string[];
  notes?: string[];
  signatureFor?: string; // signature unique maison (facture, devis)
  // Cachet + signature officiels apposés dans la zone « signatureFor » (ex. cachet
  // « Direction générale » + signature du DG sur un bon de commande établi par la DG).
  signStamp?: ContractStampData | null;
  signatures?: string[]; // signatures côte à côte (ex. « L'éditeur », « L'auteur »)
  watermark?: string; // ex. « Duplicata »
}

// Dessine une image (Data URL) ajustée dans une boîte max (mm), ratio préservé.
// Silencieux si l'image est indisponible/illisible.
function drawStampFitted(doc: jsPDF, dataUrl: string, x: number, y: number, maxW: number, maxH: number): void {
  try {
    const p = doc.getImageProperties(dataUrl);
    const ratio = p.width / p.height;
    let w = maxW;
    let h = w / ratio;
    if (h > maxH) { h = maxH; w = h * ratio; }
    doc.addImage(dataUrl, "PNG", x, y, w, h);
  } catch {
    /* image indisponible : on ignore */
  }
}

// Bloc de totaux aligné à droite ; renvoie la nouvelle position verticale.
function drawTotals(doc: jsPDF, rows: TotalRow[], startY: number): number {
  const tW = 82;
  const tX = R - tW;
  let y = startY;
  for (const t of rows) {
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
  return y;
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
  const metaAll = [...(spec.number ? [{ label: "N°", value: spec.number }] : []), ...spec.meta];
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
  y += 6;

  // Tableau secondaire « Fiche technique » en GRILLE à 2 colonnes (libellé :
  // valeur, deux par ligne) — compact, pour tenir le bon de commande sur une
  // seule page (demande opérateur : économiser le papier).
  if (spec.specTable?.rows.length) {
    if (y > PAGE_H - 34) { footer(doc); doc.addPage(); y = houseHeader(doc); }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(spec.specTable.title, L, y);
    y += 2.5;
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.5);
    doc.line(L, y, R, y);
    y += 3.5;
    const colW = CONTENT_W / 2;
    const rows = spec.specTable.rows;
    const drawCell = (k: string, v: string, x: number, yy: number): number => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.6);
      doc.setTextColor(...MUTED);
      const klabel = `${k} : `;
      doc.text(klabel, x, yy);
      const lw = doc.getTextWidth(klabel);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...INK);
      const vLines = doc.splitTextToSize(v, colW - lw - 4) as string[];
      doc.text(vLines, x + lw, yy);
      return vLines.length;
    };
    for (let i = 0; i < rows.length; i += 2) {
      const left = rows[i];
      const right = rows[i + 1];
      // Hauteur de la paire = max des deux cellules (valeurs parfois sur 2 lignes).
      const leftLines = (doc.splitTextToSize(left[1], colW - doc.getTextWidth(`${left[0]} : `) - 4) as string[]).length;
      const rightLines = right ? (doc.splitTextToSize(right[1], colW - doc.getTextWidth(`${right[0]} : `) - 4) as string[]).length : 1;
      const rh = Math.max(leftLines, rightLines) * 4 + 2;
      if (y + rh > PAGE_H - 24) { footer(doc); doc.addPage(); y = houseHeader(doc); }
      drawCell(left[0], left[1], L, y + 3.2);
      if (right) drawCell(right[0], right[1], L + colW, y + 3.2);
      y += rh;
    }
    y += 4;
  }

  // Lignes d'information sous le tableau (lieu de livraison, tolérance…).
  if (spec.infoLines?.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    for (const info of spec.infoLines) {
      doc.text(info, L, y);
      y += 4.6;
    }
    y += 3;
  }

  // Totaux (bloc aligné à droite).
  if (y > PAGE_H - 60) {
    footer(doc);
    doc.addPage();
    y = houseHeader(doc);
  }
  y = drawTotals(doc, spec.totals, y);
  y += 4;

  // Bloc de totaux secondaire (ex. récapitulatif fiscal).
  if (spec.secondaryTotals?.length) {
    if (y > PAGE_H - 55) {
      footer(doc);
      doc.addPage();
      y = houseHeader(doc);
    }
    if (spec.secondaryTitle) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(spec.secondaryTitle.toUpperCase(), L, y);
      y += 5;
    }
    y = drawTotals(doc, spec.secondaryTotals, y);
    y += 4;
  }

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

  // Signatures côte à côte (ex. « L'éditeur » / « L'auteur »).
  if (spec.signatures?.length) {
    if (y < PAGE_H - 50) y = Math.max(y + 6, PAGE_H - 50);
    else {
      footer(doc);
      doc.addPage();
      y = houseHeader(doc) + 20;
    }
    const n = spec.signatures.length;
    const colW = (CONTENT_W - (n - 1) * 10) / n;
    doc.setFontSize(8);
    spec.signatures.forEach((labelTxt, i) => {
      const cx = L + i * (colW + 10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...MUTED);
      doc.text(labelTxt.toUpperCase(), cx, y);
      doc.setDrawColor(...INK);
      doc.setLineWidth(0.3);
      doc.line(cx, y + 20, cx + colW, y + 20);
      doc.text("Signature & cachet", cx, y + 24);
    });
  } else if (spec.signatureFor) {
    // Signature unique maison (facture, devis, bon de commande).
    const stamp = spec.signStamp;
    const stamped = !!(stamp && (stamp.signature || stamp.cachet || stamp.dgName));
    const bx = R - 80;
    const reserve = stamped ? 74 : 55;
    if (y < PAGE_H - reserve) y = Math.max(y + 8, PAGE_H - reserve);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`POUR ${spec.signatureFor.toUpperCase()}`, bx, y);
    y += 4.5;
    if (stamped) {
      // Cachet « Direction générale » + signature manuscrite du DG (réglage maison).
      doc.text("Direction générale — signature & cachet", bx, y);
      const bandTop = y + 2;
      if (stamp!.signature) drawStampFitted(doc, stamp!.signature, bx, bandTop, 32, 16);
      if (stamp!.cachet) drawStampFitted(doc, stamp!.cachet, bx + 30, bandTop - 1, 44, 27);
      y = bandTop + 27;
      doc.setDrawColor(...INK);
      doc.setLineWidth(0.3);
      doc.line(bx, y, R, y);
      y += 4;
      if (stamp!.dgName) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        doc.setTextColor(...INK);
        doc.text(stamp!.dgName, bx, y);
        y += 3.8;
      }
      if (stamp!.dgTitle) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.6);
        doc.setTextColor(...MUTED);
        for (const line of stamp!.dgTitle.split("\n").map((s) => s.trim()).filter(Boolean)) {
          doc.text(line, bx, y);
          y += 3.4;
        }
      }
    } else {
      doc.text("Le responsable — signature & cachet", bx, y);
      y += 20;
      doc.setDrawColor(...INK);
      doc.setLineWidth(0.3);
      doc.line(bx, y, R, y);
      y += 4;
      doc.text("Nom, date et signature", bx, y);
    }
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

  // Avance (acompte) + solde à régler (Total − avance), à la manière du modèle
  // maison — uniquement pour une facture/proforma qui porte une avance.
  const adv = Number(invoice.advanceAmount ?? 0);
  if (adv > 0 && !isCredit) {
    const solde = Math.round((Number(invoice.totalTtc) - adv) * 100) / 100;
    totals.push({ label: invoice.advanceLabel?.trim() || "Avance", value: `− ${money(adv, cur)}` });
    totals.push({ label: "Solde à régler", value: money(solde, cur), strong: true });
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
      // Date d'émission = validation définitive (issuedAt) ; repli sur createdAt
      // pour les anciennes factures. Pour une vraie facture, on imprime aussi la
      // date d'édition/tirage (printedAt, sinon le jour où le document est produit).
      { label: "Émise le", value: new Date((invoice.issuedAt ?? invoice.createdAt) ?? Date.now()).toLocaleDateString("fr-FR") },
      ...(invoice.type === "invoice" ? [{ label: "Imprimée le", value: new Date(invoice.printedAt ?? Date.now()).toLocaleDateString("fr-FR") }] : []),
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

// Bon de commande CLIENT : document généré à partir du DEVIS ACCEPTÉ — il
// reprend automatiquement la référence du devis, les prestations, quantités,
// prix, totaux et conditions, ainsi que la confirmation du client (signataire,
// date). Pas de ressaisie : c'est la matérialisation de la commande du client.
// On conserve la numérotation en service : le bon porte la RÉFÉRENCE du devis.
export function clientOrderPdf(quote: EditorialQuote): jsPDF {
  const cur = quote.currency || "XAF";
  const client = quote.customer?.name ?? (quote.partner ? `${quote.partner.firstName} ${quote.partner.lastName}` : "");
  const columns: Column[] = [
    { label: "Prestation", width: 78, align: "left" },
    { label: "Qté", width: 18, align: "right" },
    { label: "P.U. HT", width: 34, align: "right" },
    { label: "TVA", width: 18, align: "right" },
    { label: "Total HT", width: CONTENT_W - 78 - 18 - 34 - 18, align: "right" },
  ];
  const rows = quote.lines.map((l) => [l.description, String(l.quantity), money(l.unitPrice, cur), `${Number(l.taxRate)} %`, money(l.lineTotal, cur)]);

  const notes: string[] = [`Commande passée sur la base du devis ${quote.quoteNumber}.`];
  if (quote.manuscript) notes.push(`Ouvrage : ${quote.manuscript.title}`);
  if (quote.notes) notes.push(quote.notes);
  if (quote.exclusionsNote) notes.push(quote.exclusionsNote);
  if (quote.acceptedAt) {
    notes.push(`Commande confirmée par ${quote.signerName ?? "le client"}, le ${new Date(quote.acceptedAt).toLocaleDateString("fr-FR")}${quote.acceptanceMethod ? ` · ${QUOTE_METHOD[quote.acceptanceMethod] ?? quote.acceptanceMethod}` : ""}.`);
  }

  return renderHouseDoc({
    docName: "Bon de commande client",
    fileName: `Bon de commande client ${quote.quoteNumber}`,
    number: quote.quoteNumber,
    meta: quote.validUntil ? [{ label: "Devis valable jusqu'au", value: new Date(quote.validUntil).toLocaleDateString("fr-FR") }] : [],
    partyLabel: "Commande de",
    partyName: client,
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

export function downloadClientOrderPdf(quote: EditorialQuote): void {
  clientOrderPdf(quote).save(`Bon-de-commande-client-${quote.quoteNumber}.pdf`);
}

// Attestation d'acompte : document court remis au client pour confirmer l'acompte
// (avance) reçu sur une facture. Ne change RIEN à la comptabilité — c'est une
// pièce justificative générée depuis la facture qui porte déjà l'avance.
export function advanceAttestationPdf(invoice: InvoiceDetail): jsPDF {
  const cur = invoice.currency || "XAF";
  const adv = Number(invoice.advanceAmount ?? 0);
  const solde = Math.round((Number(invoice.totalTtc) - adv) * 100) / 100;
  const columns: Column[] = [
    { label: "Prestation", width: 110, align: "left" },
    { label: "Qté", width: 20, align: "right" },
    { label: "Total HT", width: CONTENT_W - 110 - 20, align: "right" },
  ];
  const rows = invoice.lines.map((l) => [l.description, String(l.quantity), money(l.lineTotal, cur)]);
  const notes = [
    `Acompte reçu au titre de la facture ${invoice.invoiceNumber}.`,
    `Solde restant à régler : ${money(solde, cur)}.`,
    "Ce document atteste du versement de l'acompte ; il ne tient pas lieu de facture.",
  ];
  return renderHouseDoc({
    docName: "Attestation d'acompte",
    fileName: `Attestation d'acompte ${invoice.invoiceNumber}`,
    number: invoice.invoiceNumber,
    meta: [{ label: "Date", value: new Date(invoice.issuedAt ?? invoice.createdAt).toLocaleDateString("fr-FR") }],
    partyLabel: "Reçu de",
    partyName: invoice.customer.name,
    columns,
    rows,
    totals: [
      { label: "Total TTC", value: money(invoice.totalTtc, cur) },
      { label: invoice.advanceLabel?.trim() || "Acompte reçu", value: money(adv, cur), strong: true },
      { label: "Solde restant", value: money(solde, cur) },
    ],
    notes,
    signatureFor: HOUSE.legalName,
  });
}

export function downloadAdvanceAttestationPdf(invoice: InvoiceDetail): void {
  advanceAttestationPdf(invoice).save(`Attestation-acompte-${invoice.invoiceNumber}.pdf`);
}

// URL blob du PDF du bon de commande client, pour un aperçu inline (iframe).
export function clientOrderPdfBlobUrl(quote: EditorialQuote): string {
  return clientOrderPdf(quote).output("bloburl") as unknown as string;
}

// ── Bon de commande (imprimeur) ──────────────────────────────────────────────
const PO_STATUS: Record<string, string> = {
  draft: "Brouillon", approved: "Approuvé", sent: "Transmis", in_production: "En production",
  received: "Reçu", closed: "Clôturé", cancelled: "Annulé",
};

// `sign` : cachet « Direction générale » + signature du DG, apposés UNIQUEMENT si
// le bon est établi au titre de la Direction générale (sinon zone vierge).
export function purchaseOrderPdf(po: PurchaseOrder, sign?: ContractStampData | null): jsPDF {
  const cur = po.currency || "XAF";
  const printer = po.printer ? `${po.printer.partner.firstName} ${po.printer.partner.lastName}` : "—";
  const book = po.quote?.manuscript;
  const due = po.deliveryDue ? new Date(po.deliveryDue).toLocaleDateString("fr-FR") : "—";
  const tolerance = po.quantityTolerancePct != null && String(po.quantityTolerancePct) !== "" ? `± ${Number(po.quantityTolerancePct)} %` : "—";
  const location = po.deliveryLocation?.label ?? "—";
  const desc = `Impression — ${book?.title ?? "Ouvrage"}${book?.manuscriptNumber ? ` (${book.manuscriptNumber})` : ""}`;
  // Lignes de commande : désignations détaillées reportées du devis si présentes,
  // sinon ligne unique « Impression — <ouvrage> ». La quantité (tirage) est portée
  // sur la 1re ligne seulement pour ne pas suggérer une quantité par désignation.
  const hasLines = Array.isArray(po.lineItems) && po.lineItems.length > 0;
  const orderRows: string[][] = hasLines
    ? po.lineItems!.map((li, i) => [li.label, i === 0 ? String(po.orderedQuantity) : "", money(li.amount, cur)])
    : [[desc, String(po.orderedQuantity), money(po.amount, cur)]];

  // Références de l'ouvrage + fiche technique (Maquette) + consignes — MÊME source
  // que l'aperçu/impression (purchaseOrderExtras), pour un document fidèle.
  const { author, isbn, specRows, instructions, establishedBy } = purchaseOrderExtras(po);

  // FOURNISSEUR : coordonnées + mentions légales, placées SOUS le nom (comme la
  // version imprimée), puis références de l'ouvrage (auteur, ISBN). Rendu avant le
  // tableau, pas en bloc fourre-tout sous le tableau.
  const partyExtra: string[] = [];
  const sup = po.printer?.partner;
  if (sup) {
    const contact = [sup.phone, sup.email].filter(Boolean).join(" · ");
    if (sup.city) partyExtra.push(`Adresse : ${sup.city}`);
    if (contact) partyExtra.push(`Contact : ${contact}`);
    if (sup.niu) partyExtra.push(`NIU (n° contribuable) : ${sup.niu}`);
    if (sup.rccm) partyExtra.push(`Registre de commerce (RCCM) : ${sup.rccm}`);
    if (sup.bankAccount) partyExtra.push(`Compte bancaire : ${sup.bankAccount}`);
  }
  const refParts = [author ? `Auteur : ${author}` : "", isbn ? `ISBN : ${isbn}` : ""].filter(Boolean);
  if (refParts.length) partyExtra.push(refParts.join("     "));

  // SOUS le tableau : consignes à l'imprimeur, puis livraison (lieu, tolérance,
  // établi par) — comme la version imprimée.
  const infoLines: string[] = [];
  if (instructions) {
    infoLines.push("Consignes à l'imprimeur :");
    for (const line of instructions.split("\n")) infoLines.push(line);
    infoLines.push("");
  }
  infoLines.push(`Lieu de livraison : ${location}`, `Tolérance de quantité : ${tolerance}`);
  if (establishedBy) infoLines.push(`Établi par : ${establishedBy}`);

  return renderHouseDoc({
    docName: "Bon de commande",
    fileName: `Bon de commande ${po.poNumber}`,
    number: po.poNumber,
    meta: [{ label: "Livraison attendue", value: due }],
    badge: PO_STATUS[po.status] ?? po.status,
    partyLabel: "Fournisseur (imprimeur)",
    partyName: printer,
    partyExtra,
    columns: [
      { label: "Désignation", width: 118, align: "left" },
      { label: "Quantité", width: 24, align: "right" },
      { label: "Montant", width: CONTENT_W - 118 - 24, align: "right" },
    ],
    rows: orderRows,
    // Fiche technique rendue en TABLEAU (fidèle à la version imprimée).
    specTable: specRows.length > 0 ? { title: "Fiche technique (à respecter)", rows: specRows } : undefined,
    infoLines,
    totals: [{ label: "Total commande", value: money(po.amount, cur), strong: true }],
    signatureFor: HOUSE.legalName,
    // Cachet DG uniquement si le bon est établi « au titre de la Direction générale ».
    signStamp: po.establishedByFunction === "direction" ? sign ?? null : null,
  });
}

// URL « blob: » du PDF du bon de commande, pour un APERÇU inline (iframe) dans
// l'application. À révoquer (URL.revokeObjectURL) quand l'aperçu est fermé.
export function purchaseOrderPdfBlobUrl(po: PurchaseOrder, sign?: ContractStampData | null): string {
  return purchaseOrderPdf(po, sign).output("bloburl") as unknown as string;
}

// Bon de commande en PDF, renvoyé comme fichier (pour le transfert messagerie/WhatsApp).
export function purchaseOrderPdfFile(po: PurchaseOrder, sign?: ContractStampData | null): File {
  return new File([purchaseOrderPdf(po, sign).output("blob")], `Bon-de-commande-${po.poNumber}.pdf`, { type: "application/pdf" });
}
export function downloadPurchaseOrderPdf(po: PurchaseOrder, sign?: ContractStampData | null): void {
  purchaseOrderPdf(po, sign).save(`Bon-de-commande-${po.poNumber}.pdf`);
}

// ── Relevé de droits d'auteur (par contrat, sur une période) ─────────────────
const ROYALTY_SOURCE: Record<string, string> = {
  sales_order_line: "Vente", delivery: "Livraison", return_line: "Retour",
  consignment_statement: "Dépôt-vente", pos_sale: "Vente au comptoir",
};

export function royaltyStatementPdf(st: RoyaltyStatementDetail): jsPDF {
  const cur = "XAF";
  const author = `${st.contract.partner.firstName} ${st.contract.partner.lastName}`;
  const start = new Date(st.periodStart).toLocaleDateString("fr-FR");
  const end = new Date(st.periodEnd).toLocaleDateString("fr-FR");
  const remaining = st.remaining_balance ?? Number(st.balanceDue);
  const pctFmt = (r: number) => `${(r * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;

  return renderHouseDoc({
    docName: "Relevé de droits d'auteur",
    fileName: `Relevé de droits ${st.contract.contractNumber}`,
    number: st.contract.contractNumber,
    meta: [{ label: "Période", value: `${start} → ${end}` }],
    partyLabel: "Bénéficiaire",
    partyName: author,
    columns: [
      { label: "Nature", width: 66, align: "left" },
      { label: "Qté", width: 20, align: "right" },
      { label: "Base unitaire", width: 36, align: "right" },
      { label: "Taux", width: 22, align: "right" },
      { label: "Droits", width: CONTENT_W - 66 - 20 - 36 - 22, align: "right" },
    ],
    rows: st.entries.map((e) => [ROYALTY_SOURCE[e.sourceType] ?? e.sourceType, String(e.quantity), money(e.unitBaseAmount, cur), pctFmt(Number(e.rateApplied)), money(e.amount, cur)]),
    totals: [
      { label: "Droits acquis", value: money(st.totalEarned, cur) },
      { label: "À-valoir amorti", value: `− ${money(st.advanceRecouped, cur)}` },
      { label: "Solde du relevé", value: money(st.balanceDue, cur) },
      { label: "Restant à payer", value: money(remaining, cur), strong: true },
    ],
  });
}
export function downloadRoyaltyStatementPdf(st: RoyaltyStatementDetail): void {
  royaltyStatementPdf(st).save(`Releve-droits-${st.contract.contractNumber}.pdf`);
}

// ── État ANNUEL des droits d'un auteur (récapitulatif fiscal) ────────────────
export function authorRoyaltyStatementPdf(d: AuthorRoyaltyStatementData): jsPDF {
  const cur = "XAF";
  const pctFmt = (r: number) => `${(r * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
  const secondary: TotalRow[] = [
    { label: "Droits versés (brut)", value: money(d.paidGross, cur) },
    ...(d.taxWithheld > 0 ? [{ label: "Retenue à la source", value: `− ${money(d.taxWithheld, cur)}` }] : []),
    { label: "Net versé à l'auteur", value: money(d.paidNet, cur), strong: true },
    ...(d.remaining != null && d.remaining > 0 ? [{ label: "Reste à verser (indicatif)", value: money(d.remaining, cur) }] : []),
  ];
  const note = `« Droits acquis » : droits générés par les ventes de l'année, par ouvrage, au taux contractuel propre à chaque livre. « Droits versés » : montants effectivement payés à l'auteur dans l'année${d.taxWithheld > 0 ? ", après retenue à la source" : " (aucune retenue à la source appliquée)"}. Document établi au titre de la réglementation camerounaise sur le droit d'auteur ; à conserver pour la déclaration fiscale.`;

  return renderHouseDoc({
    docName: "État annuel des droits d'auteur",
    fileName: `État annuel droits ${d.authorName} ${d.year}`,
    number: String(d.year),
    meta: [{ label: "Édité le", value: new Date().toLocaleDateString("fr-FR") }],
    partyLabel: "Auteur",
    partyName: d.authorName,
    columns: [
      { label: "Ouvrage", width: 86, align: "left" },
      { label: "Exempl.", width: 22, align: "right" },
      { label: "Assiette", width: 30, align: "right" },
      { label: "Taux", width: 18, align: "right" },
      { label: "Droits acquis", width: CONTENT_W - 86 - 22 - 30 - 18, align: "right" },
    ],
    rows: d.books.map((b) => [`${b.title}${b.contractNumber ? ` (${b.contractNumber})` : ""}`, b.units.toLocaleString("fr-FR"), money(b.base, cur), pctFmt(b.rate), money(b.earned, cur)]),
    totals: [{ label: "Droits acquis dans l'année", value: money(d.earned, cur), strong: true }],
    secondaryTitle: "Récapitulatif fiscal de l'année",
    secondaryTotals: secondary,
    notes: [note],
    signatures: ["L'éditeur", "L'auteur (reçu)"],
  });
}
export function downloadAuthorRoyaltyStatementPdf(d: AuthorRoyaltyStatementData): void {
  authorRoyaltyStatementPdf(d).save(`Etat-annuel-droits-${d.authorName}-${d.year}.pdf`);
}

// ── État de commission (commercial, sur une période) ─────────────────────────
export function commissionStatementPdf(d: CommissionStatementData): jsPDF {
  const cur = "XAF";
  const rateStr = `${d.ratePct.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
  return renderHouseDoc({
    docName: "État de commission",
    fileName: `État de commission ${d.agentName}`,
    number: d.periodLabel,
    meta: [{ label: "Taux", value: rateStr }, { label: "Édité le", value: new Date().toLocaleDateString("fr-FR") }],
    partyLabel: "Commercial",
    partyName: d.agentName,
    columns: [
      { label: "Ouvrage", width: 88, align: "left" },
      { label: "Exempl. vendus", width: 32, align: "right" },
      { label: "Montant vendu", width: 32, align: "right" },
      { label: "Commission", width: CONTENT_W - 88 - 32 - 32, align: "right" },
    ],
    rows: d.books.map((b) => [b.title, b.units.toLocaleString("fr-FR"), money(b.amount, cur), money(b.commission, cur)]),
    totals: [
      { label: "Exemplaires vendus", value: d.totals.units.toLocaleString("fr-FR") },
      { label: "Montant vendu", value: money(d.totals.amount, cur) },
      { label: "Commission due", value: money(d.totals.commission, cur), strong: true },
    ],
    notes: [`Commission calculée à ${rateStr} du montant vendu sur la période. Montant dû ; le versement effectif au commercial est constaté séparément.`],
    signatures: ["La direction financière", "Le commercial (reçu)"],
  });
}
export function downloadCommissionStatementPdf(d: CommissionStatementData): void {
  commissionStatementPdf(d).save(`Etat-commission-${d.agentName}.pdf`);
}

// ── Bilan de trésorerie (rapport financier, DAF) ─────────────────────────────
// PDF VECTORIEL du bilan, fiable sur téléphone et dans les vues intégrées
// (webview) où « Imprimer → PDF » du navigateur mobile échoue ou n'est pas
// proposé. Reprend les mêmes données pré-agrégées que l'aperçu/impression.
export function treasuryBalancePdf(d: TreasuryBalancePrintData): jsPDF {
  const cur = "XAF";
  return renderHouseDoc({
    docName: "Bilan de trésorerie",
    fileName: `Bilan de trésorerie ${d.year} (${d.granularityLabel})`,
    number: String(d.year),
    meta: [
      { label: "Périodicité", value: d.granularityLabel },
      { label: "Édité le", value: new Date().toLocaleDateString("fr-FR") },
    ],
    partyLabel: "Établi pour",
    partyName: HOUSE.legalName,
    columns: [
      { label: "Période", width: 70, align: "left" },
      { label: "Entrées", width: 36, align: "right" },
      { label: "Dépenses", width: 36, align: "right" },
      { label: "Solde", width: CONTENT_W - 70 - 36 - 36, align: "right" },
    ],
    rows: d.periods.length
      ? d.periods.map((p) => [p.label, money(p.entrees, cur), money(p.depenses, cur), money(p.solde, cur)])
      : [["Aucune opération sur l'exercice.", "", "", ""]],
    totals: [
      { label: "Total entrées", value: money(d.totals.entrees, cur) },
      { label: "Total dépenses", value: `− ${money(d.totals.depenses, cur)}` },
      { label: "Solde de l'exercice", value: money(d.totals.solde, cur), strong: true },
    ],
    notes: [
      "Entrées = encaissements enregistrés. Dépenses = module Dépenses, statuts « validée » et « payée », ainsi que les décaissements de trésorerie (droits d'auteur versés…). Solde = entrées − dépenses. Montants en francs CFA (XAF), calculés automatiquement à partir des opérations enregistrées.",
    ],
  });
}
export function downloadTreasuryBalancePdf(d: TreasuryBalancePrintData): void {
  treasuryBalancePdf(d).save(`Bilan-tresorerie-${d.year}-${d.granularityLabel}.pdf`);
}

// Bilan de trésorerie DÉTAILLÉ (demande DAF) : nomme explicitement chaque entrée
// et chaque sortie, puis les totaux et le solde — PDF vectoriel (séparateurs de
// milliers propres, pas de « / »).
export function treasuryStatementPdf(d: TreasuryStatementData): jsPDF {
  const cur = "XAF";
  const dfr = (iso: string) => { try { return new Date(iso).toLocaleDateString("fr-FR"); } catch { return iso; } };
  const rows: string[][] = [];
  rows.push(["ENTRÉES", "", "", ""]);
  if (d.entrees.length) for (const e of d.entrees) rows.push([e.label, dfr(e.date), e.reference || "—", money(e.amount, cur)]);
  else rows.push(["Aucune entrée sur la période.", "", "", ""]);
  rows.push(["Total des entrées", "", "", money(d.totalEntrees, cur)]);
  rows.push(["SORTIES", "", "", ""]);
  if (d.sorties.length) for (const s of d.sorties) rows.push([s.label, dfr(s.date), s.reference || "—", money(s.amount, cur)]);
  else rows.push(["Aucune sortie sur la période.", "", "", ""]);
  rows.push(["Total des sorties", "", "", money(d.totalSorties, cur)]);

  return renderHouseDoc({
    docName: "Bilan de trésorerie",
    fileName: `Bilan de trésorerie ${d.periodLabel}`,
    number: "",
    meta: [
      { label: "Période", value: d.periodLabel },
      { label: "Édité le", value: new Date().toLocaleDateString("fr-FR") },
    ],
    partyLabel: "Établi pour",
    partyName: HOUSE.legalName,
    columns: [
      { label: "Désignation", width: 92, align: "left" },
      { label: "Date", width: 22, align: "left" },
      { label: "Référence", width: 30, align: "left" },
      { label: "Montant", width: CONTENT_W - 92 - 22 - 30, align: "right" },
    ],
    rows,
    totals: [{ label: "Solde de la période", value: money(d.solde, cur), strong: true }],
    notes: [
      "Entrées = encaissements enregistrés. Sorties = dépenses validées/payées + décaissements de trésorerie (droits d'auteur versés…). Solde de la période = total des entrées − total des sorties. Montants en francs CFA (XAF), calculés automatiquement.",
    ],
  });
}
export function downloadTreasuryStatementPdf(d: TreasuryStatementData): void {
  treasuryStatementPdf(d).save(`Bilan-tresorerie-${d.periodLabel.replace(/[^\w]+/g, "-")}.pdf`);
}
