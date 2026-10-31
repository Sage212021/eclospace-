import { jsPDF } from "jspdf";
import { HOUSE } from "./print";

// Télécharge une réponse du Service éditorial (dialogue DG) en PDF à l'en-tête
// Éclosion. Le document se lit comme un travail livré de main d'homme : AUCUNE
// mention d'« IA », aucun nom d'outil, signé « Le Service éditorial — Éditions
// Éclosion » (règle d'or des documents LIVRÉS). Rendu « markdown-léger » via
// l'API texte de jsPDF (titres, listes, paragraphes), sans dépendance lourde.

const OR: [number, number, number] = [200, 158, 42]; // or #C89E2A (filet/accents)
const NOIR: [number, number, number] = [11, 11, 12];
const GRIS: [number, number, number] = [96, 96, 96];

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
  } catch { return null; }
}

// Nettoie les marqueurs markdown d'une ligne (gras, italique, code, puces, titres).
function clean(line: string): string {
  return line
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|\s)\*([^*\s][^*]*?)\*(?=\s|$)/g, "$1$2")
    .replace(/\s+$/g, "");
}

export async function downloadSageAnswerPdf(content: string, opts?: { title?: string; subtitle?: string; dateIso?: string; fileStem?: string }): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const L = 18, R = 192, W = R - L, BOTTOM = 276;
  let y = 16;

  // En-tête : logo (si présent) + coordonnées de la maison + filet or.
  const logo = await loadLogo();
  if (logo) { try { doc.addImage(logo, "PNG", L, y, 34, 14); } catch { /* ignoré */ } }
  doc.setFontSize(7.5); doc.setTextColor(...GRIS); doc.setFont("helvetica", "normal");
  const right = [HOUSE.address, `${HOUSE.poBox} · Tél. ${HOUSE.phone}`, `${HOUSE.email} · ${HOUSE.website}`];
  right.forEach((t, i) => doc.text(t, R, y + 3 + i * 3.6, { align: "right" }));
  y += 20;
  doc.setDrawColor(...OR); doc.setLineWidth(0.6); doc.line(L, y, R, y); y += 9;

  // Titre : première ligne « # … » si présente, sinon libellé générique.
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let titleFromH1 = "";
  const firstH1 = lines.find((l) => /^#\s+\S/.test(l.trim()));
  if (firstH1) titleFromH1 = clean(firstH1.replace(/^#\s+/, ""));
  const title = opts?.title || titleFromH1 || "Note du Service éditorial";
  doc.setTextColor(...NOIR); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
  doc.splitTextToSize(title, W).forEach((t: string) => { doc.text(t, L, y); y += 7.5; });
  const date = new Date(opts?.dateIso || Date.now()).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...GRIS);
  doc.text(`Service éditorial — Éditions Éclosion · ${date}`, L, y); y += 5;
  if (opts?.subtitle) {
    doc.setFontSize(9);
    doc.splitTextToSize(opts.subtitle, W).forEach((ln: string) => { doc.text(ln, L, y); y += 4.4; });
  }
  y += 3;

  const newPageIfNeeded = (needed: number) => { if (y + needed > BOTTOM) { doc.addPage(); y = 20; } };

  // Corps « markdown-léger ».
  let skippedTitleOnce = false;
  for (let raw of lines) {
    const t = raw.trim();
    // La ligne de titre H1 déjà utilisée en en-tête n'est pas répétée.
    if (!skippedTitleOnce && firstH1 && raw === firstH1) { skippedTitleOnce = true; continue; }
    if (t === "") { y += 3.2; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { newPageIfNeeded(6); doc.setDrawColor(225, 222, 212); doc.setLineWidth(0.3); doc.line(L, y, R, y); y += 5; continue; }

    // Titres ## / ###.
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) {
      const level = h[1].length;
      const size = level <= 1 ? 14 : level === 2 ? 12.5 : 11;
      newPageIfNeeded(10);
      y += level <= 2 ? 3 : 1.5;
      doc.setFont("helvetica", "bold"); doc.setTextColor(...NOIR); doc.setFontSize(size);
      doc.splitTextToSize(clean(h[2]), W).forEach((ln: string) => { newPageIfNeeded(7); doc.text(ln, L, y); y += size * 0.52; });
      y += 2.5;
      continue;
    }

    // Tableaux markdown : on saute les séparateurs, on rend les lignes en texte compact.
    if (/^\|.*\|$/.test(t)) {
      if (/^\|[\s:|-]+\|$/.test(t)) continue; // ligne de séparation |---|
      const cells = t.replace(/^\||\|$/g, "").split("|").map((c) => clean(c.trim())).filter(Boolean);
      const text = cells.join("   ·   ");
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...NOIR);
      doc.splitTextToSize(text, W).forEach((ln: string) => { newPageIfNeeded(6); doc.text(ln, L, y); y += 4.8; });
      y += 1.2;
      continue;
    }

    // Listes à puces.
    const b = /^([-*•])\s+(.*)$/.exec(t);
    if (b) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(...NOIR);
      const wrapped = doc.splitTextToSize(clean(b[2]), W - 6);
      wrapped.forEach((ln: string, i: number) => {
        newPageIfNeeded(6);
        if (i === 0) { doc.setTextColor(...OR); doc.text("•", L, y); doc.setTextColor(...NOIR); }
        doc.text(ln, L + 6, y); y += 5.3;
      });
      y += 0.8;
      continue;
    }

    // Paragraphe justifié.
    doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(...NOIR);
    const wrapped = doc.splitTextToSize(clean(raw), W);
    wrapped.forEach((ln: string) => { newPageIfNeeded(6); doc.text(ln, L, y); y += 5.4; });
    y += 1.6;
  }

  // Signature finale (document livré au nom de la maison).
  newPageIfNeeded(16);
  y += 4;
  doc.setDrawColor(...OR); doc.setLineWidth(0.4); doc.line(L, y, L + 40, y); y += 6;
  doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...NOIR);
  doc.text("Le Service éditorial — Éditions Éclosion", L, y);

  // Pied de page sur chaque page (sans aucune mention d'outil).
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(225, 222, 212); doc.setLineWidth(0.3); doc.line(L, 283, R, 283);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...GRIS);
    doc.text("Éditions Éclosion — Service éditorial", L, 288);
    doc.text(`${p} / ${pages}`, R, 288, { align: "right" });
  }

  const stamp = new Date(opts?.dateIso || Date.now()).toISOString().slice(0, 10).replace(/-/g, "");
  doc.save(`${opts?.fileStem || `Note-editoriale-Eclosion-${stamp}`}.pdf`);
}
