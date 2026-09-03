import { PDFDocument } from "pdf-lib";
import { buildReadingReportPdf } from "./readingReportPdf";
import { readingReportFileUrl, type ReadingAssignment } from "../api/client";
import { buildReadingReport } from "./readingReport";
import { createLetterheadContext, A4, type LetterheadContext } from "./letterheadStamp";

// Version FINALE du rapport de lecture : le rapport officiel à en-tête Éclosion
// (évaluation) FUSIONNÉ, en un seul PDF, avec le rapport déposé par le relecteur
// — dont chaque page est REPOSÉE sur le papier à en-tête Éclosion (en-tête,
// filet or, pied légal, filigrane), aux couleurs de la charte. Si le dépôt n'est
// ni PDF ni image (ex. .docx), on renvoie le rapport officiel seul + indicateur.

export interface FinalReportResult {
  blob: Blob;
  fileName: string;
  merged: boolean; // true si le fichier déposé a bien été fusionné
  depositExcluded: boolean; // true si un dépôt existait mais n'a pas pu être fusionné
}

async function fetchDeposited(assignmentId: string): Promise<{ bytes: Uint8Array; mime: string; name: string } | null> {
  try {
    const resp = await fetch(readingReportFileUrl(assignmentId), { credentials: "include" });
    if (!resp.ok) return null;
    const buf = new Uint8Array(await resp.arrayBuffer());
    const mime = resp.headers.get("content-type") || "application/octet-stream";
    const disp = resp.headers.get("content-disposition") || "";
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disp);
    return { bytes: buf, mime, name: m?.[1] ? decodeURIComponent(m[1]) : "rapport-depose" };
  } catch {
    return null;
  }
}

// Repose chaque page du dépôt sur une page A4 à en-tête Éclosion (contenu mis à
// l'échelle dans la zone utile, jamais par-dessus l'en-tête ni le pied).
// Renvoie true si au moins une page a été posée, false si format non exploitable.
async function appendDepositOnLetterhead(
  merged: PDFDocument,
  ctx: LetterheadContext,
  deposited: { bytes: Uint8Array; mime: string; name: string },
): Promise<boolean> {
  const isPdf = deposited.mime.includes("pdf") || /\.pdf$/i.test(deposited.name);
  const isPng = deposited.mime.includes("png") || /\.png$/i.test(deposited.name);
  const isJpg = deposited.mime.includes("jpeg") || deposited.mime.includes("jpg") || /\.jpe?g$/i.test(deposited.name);
  const box = ctx.content;

  if (isPdf) {
    const src = await PDFDocument.load(deposited.bytes);
    const embedded = await merged.embedPdf(src, src.getPageIndices());
    for (const ep of embedded) {
      const page = merged.addPage([A4.w, A4.h]);
      ctx.stamp(page);
      const scale = Math.min(box.w / ep.width, box.h / ep.height);
      const dw = ep.width * scale, dh = ep.height * scale;
      page.drawPage(ep, { x: box.x + (box.w - dw) / 2, y: box.y + (box.h - dh) / 2, width: dw, height: dh });
    }
    return embedded.length > 0;
  }
  if (isPng || isJpg) {
    const img = isPng ? await merged.embedPng(deposited.bytes) : await merged.embedJpg(deposited.bytes);
    const page = merged.addPage([A4.w, A4.h]);
    ctx.stamp(page);
    const scale = Math.min(box.w / img.width, box.h / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    page.drawImage(img, { x: box.x + (box.w - dw) / 2, y: box.y + (box.h - dh) / 2, width: dw, height: dh });
    return true;
  }
  return false; // format non exploitable (ex. .docx)
}

function safeName(assignment: ReadingAssignment): string {
  return (buildReadingReport(assignment).manuscriptTitle || "rapport").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60);
}

// Rapport officiel à en-tête + rapport déposé (sur en-tête), réunis en un PDF.
export async function buildFinalReadingReport(assignment: ReadingAssignment): Promise<FinalReportResult> {
  const officialBytes = await buildReadingReportPdf(buildReadingReport(assignment));
  const merged = await PDFDocument.create();

  // 1) Pages du rapport officiel à en-tête.
  const official = await PDFDocument.load(officialBytes);
  const officialPages = await merged.copyPages(official, official.getPageIndices());
  officialPages.forEach((p) => merged.addPage(p));

  // 2) Rapport déposé par le relecteur, reposé sur le papier à en-tête Éclosion.
  let didMerge = false;
  let depositExcluded = false;
  const deposited = assignment.hasReportFile ? await fetchDeposited(assignment.id) : null;
  if (deposited) {
    try {
      const ctx = await createLetterheadContext(merged);
      didMerge = await appendDepositOnLetterhead(merged, ctx, deposited);
      depositExcluded = !didMerge;
    } catch {
      depositExcluded = true;
    }
  }

  const out = await merged.save();
  return {
    blob: new Blob([out as unknown as BlobPart], { type: "application/pdf" }),
    fileName: `Rapport-lecture-${safeName(assignment)}.pdf`,
    merged: didMerge,
    depositExcluded,
  };
}

// Rapport DÉPOSÉ par le relecteur, SEUL, reposé sur le papier à en-tête Éclosion
// (sans les pages du rapport officiel). Pour imprimer/transmettre le dépôt du
// relecteur sur papier à en-tête. `merged` = false si le format n'est pas
// exploitable (ex. .docx) — dans ce cas le blob renvoyé est vide.
export async function buildDepositOnLetterhead(assignment: ReadingAssignment): Promise<FinalReportResult> {
  const doc = await PDFDocument.create();
  let didMerge = false;
  let depositExcluded = false;
  const deposited = assignment.hasReportFile ? await fetchDeposited(assignment.id) : null;
  if (deposited) {
    try {
      const ctx = await createLetterheadContext(doc);
      didMerge = await appendDepositOnLetterhead(doc, ctx, deposited);
      depositExcluded = !didMerge;
    } catch {
      depositExcluded = true;
    }
  }
  // pdf-lib refuse d'enregistrer un document sans page : page à en-tête vide.
  if (doc.getPageCount() === 0) {
    const ctx = await createLetterheadContext(doc);
    ctx.stamp(doc.addPage([A4.w, A4.h]));
  }
  const out = await doc.save();
  return {
    blob: new Blob([out as unknown as BlobPart], { type: "application/pdf" }),
    fileName: `Rapport-depose-${safeName(assignment)}.pdf`,
    merged: didMerge,
    depositExcluded,
  };
}
