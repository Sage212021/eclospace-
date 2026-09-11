import { jsPDF } from "jspdf";
import { HOUSE, type ReadingReportData } from "./print";
import { isReportDisclaimer } from "./tidyProse";

// Rapport de lecture officiel (à en-tête Éclosion) en PDF côté navigateur — sert
// de PREMIÈRE partie du document final envoyé au client/auteur, avant le rapport
// déposé par le relecteur. Reprend l'en-tête (logo + coordonnées), l'évaluation
// (critères, notes, score), la recommandation et l'appréciation.

const RECO_LABELS: Record<string, string> = {
  accept: "Acceptation",
  accept_minor: "Acceptation sous réserve de corrections mineures",
  accept_major: "Acceptation sous réserve de corrections majeures",
  revise: "À revoir / réécriture",
  reject: "Refus",
};

async function loadLogo(): Promise<string | null> {
  try {
    const resp = await fetch(`${window.location.origin}/eclosion-logo.png`);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function buildReadingReportPdf(d: ReadingReportData): Promise<Uint8Array> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const L = 16, R = 194, W = R - L;
  let y = 16;

  // En-tête : logo (si disponible) + coordonnées de la maison.
  const logo = await loadLogo();
  if (logo) {
    try { doc.addImage(logo, "PNG", L, y, 34, 14); } catch { /* logo ignoré si invalide */ }
  }
  doc.setFontSize(7.5); doc.setTextColor(90); doc.setFont("helvetica", "normal");
  const rightLines = [HOUSE.address, `${HOUSE.poBox} · Tél. ${HOUSE.phone}`, `${HOUSE.email} · ${HOUSE.website}`];
  rightLines.forEach((line, i) => doc.text(line, R, y + 3 + i * 3.6, { align: "right" }));
  y += 20;
  doc.setDrawColor(200, 158, 42); doc.setLineWidth(0.6); doc.line(L, y, R, y);
  y += 8;

  // Titre + méta.
  doc.setTextColor(11, 11, 12); doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  doc.text("Rapport de lecture", L, y); y += 7;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(60);
  doc.text(`Manuscrit : ${d.manuscriptNumber}    Remis le ${new Date(d.submittedAt).toLocaleDateString("fr-FR")}`, L, y); y += 7;

  const kv = (label: string, value: string) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(120);
    doc.text(label.toUpperCase(), L, y); y += 4;
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(11, 11, 12);
    doc.text(value || "—", L, y); y += 7;
  };
  kv("Ouvrage", d.manuscriptTitle);
  kv("Relecteur", d.readerName);

  // Tableau des critères.
  y += 2;
  doc.setFillColor(11, 11, 12); doc.rect(L, y, W, 7, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
  doc.text("CRITÈRE", L + 2, y + 4.7);
  doc.text("COEF.", L + 108, y + 4.7);
  doc.text("NOTE", L + 128, y + 4.7);
  doc.text("COMMENTAIRE", L + 146, y + 4.7);
  y += 7;
  doc.setFont("helvetica", "normal"); doc.setTextColor(31, 41, 55); doc.setFontSize(8.5);
  for (const s of d.scores) {
    const label = doc.splitTextToSize(s.label, 100) as string[];
    const comment = doc.splitTextToSize(s.comment ?? "", 44) as string[];
    const rowH = Math.max(label.length, comment.length, 1) * 4 + 2;
    if (y + rowH > 280) { doc.addPage(); y = 18; }
    label.forEach((ln, i) => doc.text(ln, L + 2, y + 4 + i * 4));
    doc.text(String(s.coefficient), L + 110, y + 4);
    doc.text(`${s.score} / 10`, L + 128, y + 4);
    comment.forEach((ln, i) => doc.text(ln, L + 146, y + 4 + i * 4));
    y += rowH;
    doc.setDrawColor(230); doc.line(L, y, R, y);
  }
  doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  doc.text("Score global", L + 2, y + 5);
  doc.text(`${d.globalScore} / 10`, L + 128, y + 5);
  y += 12;

  // Recommandation + appréciation.
  const block = (label: string, value: string) => {
    if (y > 265) { doc.addPage(); y = 18; }
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(120);
    doc.text(label.toUpperCase(), L, y); y += 4;
    doc.setFontSize(10.5); doc.setTextColor(11, 11, 12);
    // On rend paragraphe par paragraphe : la recommandation et l'avertissement
    // de portée (« Ce rapport constitue un avis argumenté… ») sont en GRAS.
    const isReco = value === RECO_LABELS[d.recommendation];
    value.split("\n").forEach((para) => {
      const bold = isReco || isReportDisclaimer(para);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      const lines = doc.splitTextToSize(para, W) as string[];
      lines.forEach((ln) => { if (y > 285) { doc.addPage(); y = 18; } doc.text(ln, L, y); y += 5; });
    });
    y += 4;
  };
  block("Recommandation", RECO_LABELS[d.recommendation] ?? d.recommendation);
  if (d.overallComment) block("Appréciation générale", d.overallComment);

  // Pied de page légal.
  const py = 290;
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(120);
  doc.text(`${HOUSE.legalName} · RCCM : ${HOUSE.rccm} · NIU : ${HOUSE.niu} · N° Affil. CNPS : ${HOUSE.cnps}`, L, py);

  return new Uint8Array(doc.output("arraybuffer"));
}
