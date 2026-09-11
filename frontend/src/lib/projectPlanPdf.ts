import { jsPDF } from "jspdf";
import { HOUSE, type ProjectPlanPrintData } from "./print";

// Téléchargement DIRECT du planning en PDF (vectoriel, net) — sans passer par la
// boîte d'impression du navigateur. Reprend l'en-tête maison, un tableau
// professionnel (avec la colonne « Lieu »), et le bloc « Direction éditoriale »
// avec le cachet enregistré, en bas à droite.

const PRIORITY: Record<string, string> = { basse: "Basse", normale: "Normale", haute: "Haute" };
const STATUS: Record<string, string> = { a_faire: "À faire", en_cours: "En cours", termine: "Terminé" };

async function loadImage(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
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

const fdate = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
};
const durationDays = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null;
  const da = new Date(a).getTime(), db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db) || db < da) return null;
  return Math.round((db - da) / 86_400_000) + 1;
};

export async function buildProjectPlanPdf(d: ProjectPlanPrintData, cachetEditoriale?: string | null): Promise<Uint8Array> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const L = 12, R = 198, W = R - L;
  let y = 14;

  // En-tête : logo + coordonnées.
  const logo = await loadImage(`${window.location.origin}/eclosion-logo.png`);
  if (logo) { try { doc.addImage(logo, "PNG", L, y, 34, 14); } catch { /* ignore */ } }
  doc.setFontSize(7.5); doc.setTextColor(90); doc.setFont("helvetica", "normal");
  [HOUSE.address, `${HOUSE.poBox} · Tél. ${HOUSE.phone}`, `${HOUSE.email} · ${HOUSE.website}`]
    .forEach((line, i) => doc.text(line, R, y + 3 + i * 3.6, { align: "right" }));
  y += 20;
  doc.setDrawColor(217, 178, 26); doc.setLineWidth(0.7); doc.line(L, y, R, y); y += 8;

  // Titre + réf.
  const done = d.activities.filter((a) => a.status === "termine").length;
  const progress = d.activities.length ? Math.round((done / d.activities.length) * 100) : 0;
  const ref = `PLAN-${d.manuscriptNumber}${d.version > 1 ? ` · v${d.version}` : ""}`;
  doc.setTextColor(11, 11, 12); doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  doc.text("PLANNING DU PROJET", L, y); y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(70);
  doc.text(`Réf. ${ref}    Généré le ${new Date().toLocaleDateString("fr-FR")}    Avancement : ${progress} %`, L, y); y += 7;

  // Ouvrage + méta.
  doc.setFontSize(7.5); doc.setTextColor(120); doc.text("OUVRAGE", L, y); y += 4;
  doc.setFont("helvetica", "bold"); doc.setFontSize(11.5); doc.setTextColor(11, 11, 12);
  doc.text(`${d.manuscriptTitle}  (${d.manuscriptNumber})`, L, y); y += 6;
  const gd = durationDays(d.startDate, d.endDate);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(60);
  const metaLine = [
    d.managerName ? `Responsable : ${d.managerName}` : "",
    `Début : ${fdate(d.startDate)}`,
    `Fin : ${fdate(d.endDate)}`,
    gd !== null ? `Durée : ${gd} j` : "",
  ].filter(Boolean).join("    ");
  doc.text(doc.splitTextToSize(metaLine, W) as string[], L, y); y += 6;
  if (d.objectives) {
    doc.setFontSize(7.5); doc.setTextColor(120); doc.text("OBJECTIFS / LIVRABLES", L, y); y += 4;
    doc.setFontSize(9); doc.setTextColor(31, 41, 55);
    const ol = doc.splitTextToSize(d.objectives, W) as string[];
    doc.text(ol, L, y); y += ol.length * 4 + 3;
  }

  // Tableau : Activité | Lieu | Resp. | Début | Fin | Durée | Prio. | Statut.
  const cols = [
    { key: "act", label: "ACTIVITÉ", x: L + 1.5, w: 58 },
    { key: "lieu", label: "LIEU", x: L + 61, w: 26 },
    { key: "resp", label: "RESP.", x: L + 88, w: 24 },
    { key: "deb", label: "DÉBUT", x: L + 113, w: 18 },
    { key: "fin", label: "FIN", x: L + 132, w: 18 },
    { key: "dur", label: "DURÉE", x: L + 151, w: 13 },
    { key: "prio", label: "PRIO.", x: L + 165, w: 12 },
    { key: "stat", label: "STATUT", x: L + 178, w: W - 178 + L },
  ];
  const header = () => {
    doc.setFillColor(11, 11, 12); doc.rect(L, y, W, 6.5, "F");
    doc.setDrawColor(217, 178, 26); doc.setLineWidth(0.8); doc.line(L, y + 6.5, R, y + 6.5);
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(7);
    for (const c of cols) doc.text(c.label, c.x, y + 4.4);
    y += 6.5;
  };
  header();
  doc.setFont("helvetica", "normal"); doc.setTextColor(31, 41, 55);
  let even = false;
  if (d.activities.length === 0) {
    doc.setTextColor(120); doc.setFontSize(8.5); doc.text("Aucune activité renseignée.", L + 2, y + 5); y += 8;
  }
  for (const a of d.activities) {
    const labelLines = doc.splitTextToSize(a.label, cols[0].w - 2) as string[];
    const sub = [a.dependencies ? `Dépend. : ${a.dependencies}` : "", a.observations ?? ""].filter(Boolean).join(" — ");
    const subLines = sub ? (doc.splitTextToSize(sub, cols[0].w - 2) as string[]) : [];
    const lieuLines = doc.splitTextToSize(a.location ?? "—", cols[1].w - 2) as string[];
    const respLines = doc.splitTextToSize(a.responsible ?? "—", cols[2].w - 2) as string[];
    const rowH = Math.max(labelLines.length + subLines.length * 0.9, lieuLines.length, respLines.length, 1) * 4 + 3;
    if (y + rowH > 276) { doc.addPage(); y = 16; header(); doc.setFont("helvetica", "normal"); doc.setTextColor(31, 41, 55); }
    if (even) { doc.setFillColor(250, 248, 242); doc.rect(L, y, W, rowH, "F"); }
    even = !even;
    doc.setFontSize(8.5); doc.setTextColor(11, 11, 12); doc.setFont("helvetica", "bold");
    labelLines.forEach((ln, i) => doc.text(ln, cols[0].x, y + 4 + i * 4));
    if (subLines.length) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(107, 114, 128);
      subLines.forEach((ln, i) => doc.text(ln, cols[0].x, y + 4 + labelLines.length * 4 + i * 3));
    }
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(31, 41, 55);
    lieuLines.forEach((ln, i) => doc.text(ln, cols[1].x, y + 4 + i * 4));
    respLines.forEach((ln, i) => doc.text(ln, cols[2].x, y + 4 + i * 4));
    doc.text(fdate(a.startDate), cols[3].x, y + 4);
    doc.text(fdate(a.endDate), cols[4].x, y + 4);
    const dur = durationDays(a.startDate, a.endDate);
    doc.text(dur !== null ? `${dur} j` : "—", cols[5].x, y + 4);
    doc.text(PRIORITY[a.priority] ?? a.priority, cols[6].x, y + 4);
    doc.text(STATUS[a.status] ?? a.status, cols[7].x, y + 4);
    doc.setDrawColor(231, 226, 212); doc.setLineWidth(0.2); doc.line(L, y + rowH, R, y + rowH);
    y += rowH;
  }

  // Observations globales.
  if (d.notes) {
    y += 4; if (y > 250) { doc.addPage(); y = 16; }
    doc.setFontSize(7.5); doc.setTextColor(120); doc.text("OBSERVATIONS ET POINTS DE VIGILANCE", L, y); y += 4;
    doc.setFontSize(9); doc.setTextColor(31, 41, 55);
    const nl = doc.splitTextToSize(d.notes, W) as string[];
    doc.text(nl, L, y); y += nl.length * 4 + 2;
  }

  // Bloc « Direction éditoriale » à l'extrême droite + cachet.
  y = Math.max(y + 8, 250);
  if (y > 258) { doc.addPage(); y = 40; }
  doc.setFontSize(7.5); doc.setTextColor(120); doc.text("DIRECTION ÉDITORIALE", R, y, { align: "right" }); y += 4;
  doc.setFontSize(8); doc.setTextColor(107, 114, 128); doc.text("Signature et cachet", R, y, { align: "right" }); y += 3;
  if (cachetEditoriale) {
    try { doc.addImage(cachetEditoriale, "PNG", R - 34, y, 34, 34); } catch { /* ignore */ }
  }

  // Pied légal.
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(120);
  doc.text(`${HOUSE.legalName} · RCCM : ${HOUSE.rccm} · NIU : ${HOUSE.niu} · N° Affil. CNPS : ${HOUSE.cnps}`, L, 290);

  return doc.output("arraybuffer") as unknown as Uint8Array;
}

export async function downloadProjectPlanPdf(d: ProjectPlanPrintData, cachetEditoriale?: string | null): Promise<void> {
  const bytes = await buildProjectPlanPdf(d, cachetEditoriale);
  const safe = (d.manuscriptTitle || "planning").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60);
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Planning-${safe}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
