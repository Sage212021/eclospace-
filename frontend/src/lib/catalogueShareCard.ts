import { jsPDF } from "jspdf";
import { catalogueCoverUrl, type CatalogueItem } from "../api/client";

// ─────────────────────────────────────────────────────────────────────────────
// Fiche catalogue PARTAGEABLE (couverture + légende) — demande opérateur
// 19/11/2026. On reproduit fidèlement le modèle de la maison : couverture en
// haut, puis en-tête « ÉDITIONS ÉCLOSION », titre, auteur, collection, genre,
// (pages), ISBN, résumé, pied « L'Avenir du livre. ». Deux langues (FR/EN).
//
// Le rendu est fait sur un CANVAS (aucune dépendance html2canvas) : on maîtrise
// exactement la mise en page, la charte (or/noir/blanc/ivoire) et le retour à la
// ligne. Le même canvas sert à produire l'IMAGE (PNG), le PDF et l'impression.
// Aucune mention « IA » n'apparaît (document livré — règle permanente).
// ─────────────────────────────────────────────────────────────────────────────

export type ShareLang = "fr" | "en";

const INK = "#0B0B0C";
const IVORY = "#FAF8F2";
const GOLD = "#D9B21A";
const MUTED = "#6B6B6B";
const GREEN = "#2F7D4A";
const LINE = "#E6E1D4";

const SANS = "'Helvetica Neue', Arial, sans-serif";
const MONO = "'DejaVu Sans Mono', 'Courier New', monospace";

type Strings = {
  country: string;
  author: (n: number) => string;
  collection: string;
  genre: string;
  pages: string;
  isbn: string;
  synopsis: string;
  tagline: string;
};

const STRINGS: Record<ShareLang, Strings> = {
  fr: {
    country: "Cameroun",
    author: (n) => (n > 1 ? "Auteurs" : "Auteur"),
    collection: "Collection",
    genre: "Genre",
    pages: "Nombre de pages",
    isbn: "ISBN",
    synopsis: "RÉSUMÉ",
    tagline: "L'Avenir du livre.",
  },
  en: {
    country: "Cameroon",
    author: (n) => (n > 1 ? "Authors" : "Author"),
    collection: "Collection",
    genre: "Genre",
    pages: "Number of pages",
    isbn: "ISBN",
    synopsis: "SYNOPSIS",
    tagline: "The Future of Books.",
  },
};

// Valeurs d'affichage selon la langue, avec repli sur l'autre langue pour ne
// jamais produire une fiche vide (ex. résumé français pas encore transmis).
export function cardFields(item: CatalogueItem, lang: ShareLang) {
  const collection = lang === "fr" ? item.collectionLabel : item.collectionLabelEn;
  const genre = lang === "fr" ? item.genreLabel : item.genreLabelEn;
  const synopsis = (lang === "fr" ? item.summary : item.summaryEn) || (lang === "fr" ? item.summaryEn : item.summary) || "";
  return {
    title: item.title,
    authors: item.authors,
    collection: collection ?? null,
    genre: genre ?? null,
    pages: item.pages ?? null,
    isbn: item.isbn ?? null,
    synopsis,
  };
}

// Récupère la couverture (authentifiée, même origine en production) en dataURL,
// pour un dessin fiable sur le canvas. Renvoie null si l'ouvrage n'a pas d'image.
export async function loadCoverDataUrl(item: CatalogueItem): Promise<string | null> {
  if (!item.hasCover) return null;
  try {
    const res = await fetch(catalogueCoverUrl(item.id), { credentials: "include" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Découpe un texte en lignes qui tiennent dans `maxWidth` (mesure réelle via le
// contexte). Respecte les retours à la ligne explicites (paragraphes).
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const rawPara of text.split("\n")) {
    const para = rawPara.trim();
    if (para === "") {
      out.push(""); // ligne vide = séparation de paragraphe
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const probe = line ? `${line} ${word}` : word;
      if (ctx.measureText(probe).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = probe;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export interface RenderedCard {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

// Dessine la fiche complète sur un canvas haute résolution et le renvoie.
export async function renderCatalogueCard(item: CatalogueItem, lang: ShareLang): Promise<RenderedCard> {
  const S = STRINGS[lang];
  const f = cardFields(item, lang);
  const coverUrl = await loadCoverDataUrl(item);
  const coverImg = coverUrl ? await loadImage(coverUrl).catch(() => null) : null;

  // Géométrie (en pixels « logiques » ; on applique un facteur d'échelle pour la
  // netteté). Largeur pensée pour un partage lisible (WhatsApp, impression A4).
  const SCALE = 2;
  const W = 760;
  const PAD = 44;
  const CW = W - PAD * 2; // largeur de contenu

  // Hauteur de la couverture : image CONTENUE dans une boîte (jamais rognée),
  // largeur = contenu, hauteur plafonnée pour garder l'ensemble équilibré.
  let coverBoxH = 0;
  let coverDrawW = 0;
  let coverDrawH = 0;
  if (coverImg && coverImg.naturalWidth > 0) {
    const maxH = 760;
    const scale = Math.min(CW / coverImg.naturalWidth, maxH / coverImg.naturalHeight);
    coverDrawW = coverImg.naturalWidth * scale;
    coverDrawH = coverImg.naturalHeight * scale;
    coverBoxH = coverDrawH;
  } else {
    coverBoxH = 300; // vignette de repli (titre)
  }

  // Mesure préalable pour connaître la hauteur totale (deux passes).
  const measure = document.createElement("canvas").getContext("2d")!;
  const metaLines: { label: string; value: string; mono?: boolean }[] = [];
  metaLines.push({ label: S.author(f.authors.length), value: f.authors.join(", ") || "—" });
  if (f.collection) metaLines.push({ label: S.collection, value: f.collection });
  if (f.genre) metaLines.push({ label: S.genre, value: f.genre });
  if (f.pages != null) metaLines.push({ label: S.pages, value: String(f.pages), mono: true });
  if (f.isbn) metaLines.push({ label: S.isbn, value: f.isbn, mono: true });

  const TITLE_SIZE = 30;
  const META_SIZE = 16.5;
  const META_LH = 25;
  const BODY_SIZE = 16;
  const BODY_LH = 24;
  const HEAD_SIZE = 15;

  // Lignes du titre.
  measure.font = `800 ${TITLE_SIZE}px ${SANS}`;
  const titleLines = wrapText(measure, (f.title || "").toLocaleUpperCase(lang), CW);

  // Lignes de chaque valeur meta (label + valeur sur la même ligne, repli si long).
  measure.font = `400 ${META_SIZE}px ${SANS}`;
  const metaRendered: { text: string; mono?: boolean }[] = [];
  for (const m of metaLines) {
    const prefix = `${m.label} : `;
    measure.font = `700 ${META_SIZE}px ${SANS}`;
    const prefixW = measure.measureText(prefix).width;
    measure.font = m.mono ? `400 ${META_SIZE}px ${MONO}` : `400 ${META_SIZE}px ${SANS}`;
    const valueLines = wrapText(measure, m.value, CW - prefixW);
    valueLines.forEach((vl, i) => metaRendered.push({ text: i === 0 ? prefix + vl : vl, mono: m.mono }));
  }

  // Lignes du synopsis.
  measure.font = `400 ${BODY_SIZE}px ${SANS}`;
  const bodyLines = f.synopsis ? wrapText(measure, f.synopsis, CW) : [];

  // Calcul de la hauteur totale.
  let y = PAD;
  y += coverBoxH + 22;                     // couverture
  y += 20 + 6 + 20 + 20 + 14;              // en-tête éditeur (4 lignes) + espace
  y += 1 + 18;                             // filet séparateur
  y += titleLines.length * (TITLE_SIZE + 6) + 12;
  y += metaRendered.length * META_LH + 16;
  y += 1 + 16;                             // filet avant résumé
  y += HEAD_SIZE + 14;                     // titre « RÉSUMÉ »
  y += bodyLines.reduce((h, l) => h + (l === "" ? BODY_LH * 0.5 : BODY_LH), 0) + 20;
  y += 1 + 16;                             // filet avant pied
  y += 20 + 6 + 18;                        // pied (2 lignes)
  const H = Math.ceil(y + PAD);

  // Canvas final.
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * SCALE);
  canvas.height = Math.round(H * SCALE);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "alphabetic";

  // Fond blanc.
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, W, H);

  const drawRule = (yy: number) => {
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, yy + 0.5);
    ctx.lineTo(W - PAD, yy + 0.5);
    ctx.stroke();
  };

  let cy = PAD;

  // 1) Couverture (sur fond ivoire, contenue, centrée).
  ctx.fillStyle = IVORY;
  roundRect(ctx, PAD, cy, CW, coverBoxH, 10);
  ctx.fill();
  if (coverImg && coverDrawW > 0) {
    const ix = PAD + (CW - coverDrawW) / 2;
    ctx.drawImage(coverImg, ix, cy, coverDrawW, coverDrawH);
  } else {
    ctx.fillStyle = INK;
    ctx.font = `700 22px ${SANS}`;
    ctx.textAlign = "center";
    wrapText(ctx, (f.title || "").toLocaleUpperCase(lang), CW - 40).forEach((l, i) => {
      ctx.fillText(l, W / 2, cy + 60 + i * 30);
    });
    ctx.textAlign = "left";
  }
  cy += coverBoxH + 22;

  // 2) En-tête éditeur.
  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.font = `800 20px ${SANS}`;
  ctx.fillText("ÉDITIONS ÉCLOSION", PAD, cy + 16);
  cy += 20 + 6;
  ctx.font = `700 16px ${SANS}`;
  ctx.fillText(S.country, PAD, cy + 14);
  cy += 20;
  ctx.font = `400 15px ${SANS}`;
  ctx.fillStyle = GREEN;
  ctx.fillText("edition@eclosion.cm   ·   eclosion.cm", PAD, cy + 13);
  cy += 20 + 14;

  // 3) Filet.
  drawRule(cy);
  cy += 1 + 18;

  // 4) Titre.
  ctx.fillStyle = INK;
  ctx.font = `800 ${TITLE_SIZE}px ${SANS}`;
  for (const l of titleLines) {
    ctx.fillText(l, PAD, cy + TITLE_SIZE);
    cy += TITLE_SIZE + 6;
  }
  cy += 12;

  // 5) Métadonnées (label gras + valeur).
  for (const m of metaRendered) {
    // On re-sépare le préfixe « Label : » pour le mettre en gras.
    const sep = m.text.indexOf(" : ");
    if (sep !== -1 && /[A-Za-zÀ-ÿ]/.test(m.text.slice(0, sep))) {
      const label = m.text.slice(0, sep + 3);
      const value = m.text.slice(sep + 3);
      ctx.font = `700 ${META_SIZE}px ${SANS}`;
      ctx.fillStyle = INK;
      ctx.fillText(label, PAD, cy + META_SIZE);
      const lw = ctx.measureText(label).width;
      ctx.font = m.mono ? `400 ${META_SIZE}px ${MONO}` : `400 ${META_SIZE}px ${SANS}`;
      ctx.fillStyle = INK;
      ctx.fillText(value, PAD + lw, cy + META_SIZE);
    } else {
      ctx.font = m.mono ? `400 ${META_SIZE}px ${MONO}` : `400 ${META_SIZE}px ${SANS}`;
      ctx.fillStyle = INK;
      ctx.fillText(m.text, PAD, cy + META_SIZE);
    }
    cy += META_LH;
  }
  cy += 16;

  // 6) Filet + titre « RÉSUMÉ ».
  drawRule(cy);
  cy += 1 + 16;
  ctx.font = `800 ${HEAD_SIZE}px ${SANS}`;
  ctx.fillStyle = GOLD;
  ctx.fillText(S.synopsis, PAD, cy + HEAD_SIZE);
  cy += HEAD_SIZE + 14;

  // 7) Corps du résumé.
  ctx.fillStyle = INK;
  ctx.font = `400 ${BODY_SIZE}px ${SANS}`;
  for (const l of bodyLines) {
    if (l === "") {
      cy += BODY_LH * 0.5;
      continue;
    }
    ctx.fillText(l, PAD, cy + BODY_SIZE);
    cy += BODY_LH;
  }
  cy += 20;

  // 8) Filet + pied.
  drawRule(cy);
  cy += 1 + 16;
  ctx.font = `800 18px ${SANS}`;
  ctx.fillStyle = INK;
  ctx.fillText("ÉDITIONS ÉCLOSION", PAD, cy + 16);
  cy += 20 + 6;
  ctx.font = `italic 400 15px ${SANS}`;
  ctx.fillStyle = MUTED;
  ctx.fillText(S.tagline, PAD, cy + 13);

  return { canvas, width: W, height: H };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png"): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Image introuvable"))), type, 0.95);
  });
}

function safeName(item: CatalogueItem): string {
  return (item.title || "ouvrage").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "ouvrage";
}

// Produit l'IMAGE PNG de la fiche sous forme de File (prête au partage/téléchargement).
export async function catalogueCardPngFile(item: CatalogueItem, lang: ShareLang): Promise<File> {
  const { canvas } = await renderCatalogueCard(item, lang);
  const blob = await canvasToBlob(canvas, "image/png");
  return new File([blob], `${safeName(item)}-${lang}.png`, { type: "image/png" });
}

// Produit le PDF (une ou plusieurs pages A4) de la fiche.
export async function catalogueCardPdfFile(item: CatalogueItem, lang: ShareLang): Promise<File> {
  const { canvas, width, height } = await renderCatalogueCard(item, lang);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;
  const imgW = pageW - margin * 2;
  const imgH = (height / width) * imgW;
  const dataUrl = canvas.toDataURL("image/png");
  if (imgH <= pageH - margin * 2) {
    doc.addImage(dataUrl, "PNG", margin, margin, imgW, imgH, undefined, "FAST");
  } else {
    // Fiche plus haute qu'une page : on la découpe en tranches verticales.
    const usableH = pageH - margin * 2;
    const sliceHpx = Math.floor((usableH / imgW) * width); // px de source par page
    let yPx = 0;
    let first = true;
    while (yPx < height) {
      const hPx = Math.min(sliceHpx, height - yPx);
      const slice = document.createElement("canvas");
      slice.width = Math.round(width * 2);
      slice.height = Math.round(hPx * 2);
      const sctx = slice.getContext("2d")!;
      sctx.drawImage(canvas, 0, Math.round(yPx * 2), Math.round(width * 2), Math.round(hPx * 2), 0, 0, slice.width, slice.height);
      if (!first) doc.addPage();
      doc.addImage(slice.toDataURL("image/png"), "PNG", margin, margin, imgW, (hPx / width) * imgW, undefined, "FAST");
      first = false;
      yPx += hPx;
    }
  }
  const blob = doc.output("blob");
  return new File([blob], `${safeName(item)}-${lang}.pdf`, { type: "application/pdf" });
}

// Ouvre la fiche (image) dans une fenêtre d'impression.
export async function printCatalogueCard(item: CatalogueItem, lang: ShareLang): Promise<void> {
  const { canvas } = await renderCatalogueCard(item, lang);
  const dataUrl = canvas.toDataURL("image/png");
  const w = window.open("", "_blank", "noopener,width=820,height=1000");
  if (!w) throw new Error("Impossible d'ouvrir la fenêtre d'impression (fenêtres bloquées ?).");
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${safeName(item)}</title>` +
      `<style>@page{margin:10mm}html,body{margin:0;padding:0}img{width:100%;height:auto;display:block}</style></head>` +
      `<body><img src="${dataUrl}" onload="setTimeout(function(){window.focus();window.print();},150)"></body></html>`,
  );
  w.document.close();
}

// Partage « natif » (Web Share API) avec le fichier image quand c'est possible
// (tablette / téléphone → WhatsApp, etc.). Renvoie true si le partage natif a
// été utilisé ; false sinon (l'appelant propose alors téléchargement + WhatsApp).
export async function shareCatalogueCardNative(item: CatalogueItem, lang: ShareLang, text: string): Promise<boolean> {
  const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean; share?: (d: ShareData) => Promise<void> };
  if (!nav.share) return false;
  const file = await catalogueCardPngFile(item, lang);
  const data: ShareData & { files?: File[] } = { title: item.title, text, files: [file] };
  if (nav.canShare && !nav.canShare(data)) {
    // Partage de fichier non supporté : on partage au moins le texte.
    try {
      await nav.share({ title: item.title, text });
      return true;
    } catch {
      return false;
    }
  }
  try {
    await nav.share(data);
    return true;
  } catch (e) {
    // L'utilisateur a annulé : on considère que c'est traité (pas de repli).
    if (e instanceof DOMException && e.name === "AbortError") return true;
    return false;
  }
}

export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
