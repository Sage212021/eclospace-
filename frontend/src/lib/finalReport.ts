import { PDFDocument } from "pdf-lib";
import { buildReadingReportPdf } from "./readingReportPdf";
import { readingReportFileUrl, type ReadingAssignment } from "../api/client";
import { buildReadingReport } from "./readingReport";

// Version FINALE du rapport de lecture : le rapport officiel à en-tête Éclosion
// (évaluation) FUSIONNÉ, en un seul PDF, avec le rapport déposé par le relecteur
// (ses pages ajoutées à la suite). Si le dépôt n'est pas fusionnable (ni PDF ni
// image), on renvoie le rapport officiel seul (repli) + un indicateur.

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

export async function buildFinalReadingReport(assignment: ReadingAssignment): Promise<FinalReportResult> {
  const officialBytes = await buildReadingReportPdf(buildReadingReport(assignment));
  const merged = await PDFDocument.create();

  // 1) Pages du rapport officiel à en-tête.
  const official = await PDFDocument.load(officialBytes);
  const officialPages = await merged.copyPages(official, official.getPageIndices());
  officialPages.forEach((p) => merged.addPage(p));

  // 2) Rapport déposé par le relecteur (fusionné harmonieusement à la suite).
  let didMerge = false;
  let depositExcluded = false;
  const deposited = assignment.hasReportFile ? await fetchDeposited(assignment.id) : null;
  if (deposited) {
    const isPdf = deposited.mime.includes("pdf") || /\.pdf$/i.test(deposited.name);
    const isPng = deposited.mime.includes("png") || /\.png$/i.test(deposited.name);
    const isJpg = deposited.mime.includes("jpeg") || deposited.mime.includes("jpg") || /\.jpe?g$/i.test(deposited.name);
    try {
      if (isPdf) {
        const src = await PDFDocument.load(deposited.bytes);
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
        didMerge = true;
      } else if (isPng || isJpg) {
        const img = isPng ? await merged.embedPng(deposited.bytes) : await merged.embedJpg(deposited.bytes);
        const a4 = merged.addPage([595.28, 841.89]);
        const scaled = img.scaleToFit(555, 800);
        a4.drawImage(img, { x: (595.28 - scaled.width) / 2, y: (841.89 - scaled.height) / 2, width: scaled.width, height: scaled.height });
        didMerge = true;
      } else {
        depositExcluded = true; // format non fusionnable (ex. .docx)
      }
    } catch {
      depositExcluded = true;
    }
  }

  const out = await merged.save();
  const safeTitle = (buildReadingReport(assignment).manuscriptTitle || "rapport").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60);
  return {
    blob: new Blob([out as unknown as BlobPart], { type: "application/pdf" }),
    fileName: `Rapport-lecture-${safeTitle}.pdf`,
    merged: didMerge,
    depositExcluded,
  };
}
