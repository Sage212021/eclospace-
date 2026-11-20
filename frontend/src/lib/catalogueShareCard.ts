import { jsPDF } from "jspdf";
import { catalogueCoverUrl, type CatalogueItem } from "../api/client";

// ─────────────────────────────────────────────────────────────────────────────
// Partage d'un ouvrage du catalogue (demande opérateur 19/11/2026, précisée) :
//   • la COUVERTURE part en IMAGE (sa seule raison d'être image : c'est une photo) ;
//   • la LÉGENDE qui suit reste du TEXTE LIBRE — sélectionnable et copiable —, PAS
//     un bloc-image. On ne « fige » donc jamais le texte dans une image.
// Le partage natif envoie l'image de couverture + le texte de la légende (qui
// devient la légende/caption du message, copiable par le destinataire). On
// fournit aussi « copier le texte », le téléchargement de la couverture, un PDF
// (dont le texte reste sélectionnable) et l'impression. Deux langues (FR/EN).
// Aucune mention « IA » (document livré — règle permanente).
// ─────────────────────────────────────────────────────────────────────────────

export type ShareLang = "fr" | "en";

type Strings = {
  country: string;
  author: (n: number) => string;
  collection: string;
  genre: string;
  pages: string;
  isbn: string;
  price: string;
  synopsis: string;
  tagline: string;
  sharedVia: string;
};

const STRINGS: Record<ShareLang, Strings> = {
  fr: {
    country: "Cameroun",
    author: (n) => (n > 1 ? "Auteurs" : "Auteur"),
    collection: "Collection",
    genre: "Genre",
    pages: "Nombre de pages",
    isbn: "ISBN",
    price: "Prix",
    synopsis: "RÉSUMÉ",
    tagline: "L'Avenir du livre.",
    sharedVia: "Partagé depuis Eclospace",
  },
  en: {
    country: "Cameroon",
    author: (n) => (n > 1 ? "Authors" : "Author"),
    collection: "Collection",
    genre: "Genre",
    pages: "Number of pages",
    isbn: "ISBN",
    price: "Price",
    synopsis: "SYNOPSIS",
    tagline: "The Future of Books.",
    sharedVia: "Shared from Eclospace",
  },
};

// Le franc CFA (XAF) est à PARITÉ FIXE avec l'euro : 655,957 FCFA = 1 €.
const FCFA_PER_EUR = 655.957;

// Prix affiché : FCFA + équivalent en euros (ex. « 2 500 FCFA · 3,81 € »).
export function formatPrice(fcfa: number, lang: ShareLang): string {
  const eur = fcfa / FCFA_PER_EUR;
  if (lang === "fr") {
    const f = fcfa.toLocaleString("fr-FR");
    const e = eur.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${f} FCFA · ${e} €`;
  }
  const f = fcfa.toLocaleString("en-US");
  const e = eur.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${f} FCFA · €${e}`;
}

// Valeurs d'affichage selon la langue, avec repli sur l'autre langue pour ne
// jamais produire une fiche vide (ex. résumé français pas encore transmis).
export function cardFields(item: CatalogueItem, lang: ShareLang) {
  const collection = lang === "fr" ? item.collectionLabel : item.collectionLabelEn;
  const genre = lang === "fr" ? item.genreLabel : item.genreLabelEn;
  const synopsis = (lang === "fr" ? item.summary : item.summaryEn) || (lang === "fr" ? item.summaryEn : item.summary) || "";
  // Auteur d'affichage (nom de couverture) s'il est défini ; sinon les auteurs réels.
  const authors = item.authorDisplay ? [item.authorDisplay] : item.authors;
  return {
    title: item.title,
    authors,
    collection: collection ?? null,
    genre: genre ?? null,
    pages: item.pages ?? null,
    isbn: item.isbn ?? null,
    price: item.pricePublic ?? null,
    synopsis,
  };
}

// Texte LIBRE de la légende (sélectionnable / copiable). Aucun marqueur « ## » :
// du texte propre, prêt à coller dans WhatsApp, un email, un document, etc.
// Signature de l'origine du partage. « signature » choisit le rendu :
//  • "none"     : aucune signature (ex. impression/PDF qui la posent eux-mêmes
//                 en petit et en gris, un vrai style à part) ;
//  • "plain"    : texte simple (copier-coller propre, sans aucun marqueur) ;
//  • "whatsapp" : en ITALIQUE via la mise en forme WhatsApp (`_texte_`), pour un
//                 rendu plus léger et discret, « un autre style » que le corps.
// (En message texte, la TAILLE de police est imposée par l'app ; l'italique est
// le seul moyen de distinguer la signature sans transformer le texte en image.)
export function catalogueLegendText(
  item: CatalogueItem,
  lang: ShareLang,
  opts: { signature?: "none" | "plain" | "whatsapp" } = {},
): string {
  const S = STRINGS[lang];
  const f = cardFields(item, lang);
  const lines: string[] = [];
  lines.push("ÉDITIONS ÉCLOSION");
  lines.push(S.country);
  lines.push("edition@eclosion.cm");
  lines.push("eclosion.cm");
  lines.push("");
  lines.push((f.title || "").toLocaleUpperCase(lang));
  lines.push("");
  lines.push(`${S.author(f.authors.length)} : ${f.authors.join(", ") || "—"}`);
  if (f.collection) lines.push(`${S.collection} : ${f.collection}`);
  if (f.genre) lines.push(`${S.genre} : ${f.genre}`);
  if (f.pages != null) lines.push(`${S.pages} : ${f.pages}`);
  if (f.isbn) lines.push(`${S.isbn} : ${f.isbn}`);
  if (f.price != null) lines.push(`${S.price} : ${formatPrice(f.price, lang)}`);
  if (f.synopsis) {
    lines.push("");
    lines.push(S.synopsis);
    lines.push("");
    lines.push(f.synopsis.trim());
  }
  lines.push("");
  lines.push("ÉDITIONS ÉCLOSION");
  lines.push(S.tagline);
  const signature = opts.signature ?? "plain";
  if (signature !== "none") {
    lines.push("");
    lines.push(signature === "whatsapp" ? `_${S.sharedVia}_` : S.sharedVia);
  }
  return lines.join("\n");
}

function safeName(item: CatalogueItem): string {
  return (item.title || "ouvrage").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "ouvrage";
}

// Récupère la couverture (authentifiée, même origine en production) en Blob.
async function fetchCoverBlob(item: CatalogueItem): Promise<Blob | null> {
  if (!item.hasCover) return null;
  try {
    const res = await fetch(catalogueCoverUrl(item.id), { credentials: "include" });
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => reject(new Error("Lecture de la couverture impossible"));
    r.readAsDataURL(blob);
  });
}

export async function loadCoverDataUrl(item: CatalogueItem): Promise<string | null> {
  const blob = await fetchCoverBlob(item);
  return blob ? blobToDataUrl(blob) : null;
}

// La COUVERTURE en fichier image (pour le partage natif / le téléchargement).
export async function catalogueCoverFile(item: CatalogueItem): Promise<File | null> {
  const blob = await fetchCoverBlob(item);
  if (!blob) return null;
  const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
  return new File([blob], `${safeName(item)}-couverture.${ext}`, { type: blob.type || "image/jpeg" });
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

export async function copyLegendText(item: CatalogueItem, lang: ShareLang): Promise<boolean> {
  const text = catalogueLegendText(item, lang);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Partage natif : COUVERTURE (image) + LÉGENDE (texte). Le texte reste du texte
// (caption copiable), jamais figé dans l'image. Renvoie true si traité.
export async function shareCatalogueNative(item: CatalogueItem, lang: ShareLang): Promise<boolean> {
  const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean; share?: (d: ShareData) => Promise<void> };
  if (!nav.share) return false;
  const text = catalogueLegendText(item, lang, { signature: "whatsapp" });
  const cover = await catalogueCoverFile(item);
  const withFile: ShareData & { files?: File[] } = { title: item.title, text, ...(cover ? { files: [cover] } : {}) };
  const data: ShareData = cover && nav.canShare && nav.canShare(withFile) ? withFile : { title: item.title, text };
  try {
    await nav.share(data);
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return true; // annulé : traité
    return false;
  }
}

// PDF « fiche » : couverture (image) en haut puis la légende en TEXTE (le texte
// du PDF reste sélectionnable / copiable). Une ou plusieurs pages A4.
export async function catalogueCardPdfFile(item: CatalogueItem, lang: ShareLang): Promise<File> {
  const S = STRINGS[lang];
  const f = cardFields(item, lang);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 16;
  const maxW = pageW - M * 2;
  let y = M;

  const ensure = (needed: number) => {
    if (y + needed > pageH - M) {
      doc.addPage();
      y = M;
    }
  };

  // Couverture (image) centrée, hauteur plafonnée.
  const coverUrl = await loadCoverDataUrl(item);
  if (coverUrl) {
    try {
      const props = doc.getImageProperties(coverUrl);
      const maxImgH = 95;
      const scale = Math.min(maxW / props.width, maxImgH / props.height);
      const w = props.width * scale;
      const h = props.height * scale;
      doc.addImage(coverUrl, props.fileType === "PNG" ? "PNG" : "JPEG", (pageW - w) / 2, y, w, h, undefined, "FAST");
      y += h + 8;
    } catch {
      /* couverture illisible : on continue sans */
    }
  }

  // En-tête éditeur.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(11, 11, 12);
  doc.text("ÉDITIONS ÉCLOSION", M, y + 4);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(`${S.country}  ·  edition@eclosion.cm  ·  eclosion.cm`, M, y + 3);
  y += 8;
  doc.setDrawColor(220, 215, 205);
  doc.line(M, y, pageW - M, y);
  y += 8;

  // Titre.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(11, 11, 12);
  for (const l of doc.splitTextToSize((f.title || "").toLocaleUpperCase(lang), maxW)) {
    ensure(9);
    doc.text(l, M, y + 6);
    y += 9;
  }
  y += 4;

  // Métadonnées (label gras + valeur).
  const meta: [string, string][] = [];
  meta.push([`${S.author(f.authors.length)} :`, f.authors.join(", ") || "—"]);
  if (f.collection) meta.push([`${S.collection} :`, f.collection]);
  if (f.genre) meta.push([`${S.genre} :`, f.genre]);
  if (f.pages != null) meta.push([`${S.pages} :`, String(f.pages)]);
  if (f.isbn) meta.push([`${S.isbn} :`, f.isbn]);
  if (f.price != null) meta.push([`${S.price} :`, formatPrice(f.price, lang)]);
  doc.setFontSize(11);
  for (const [label, value] of meta) {
    ensure(6);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(11, 11, 12);
    doc.text(label, M, y + 4);
    const lw = doc.getTextWidth(label + " ");
    doc.setFont("helvetica", "normal");
    const valLines = doc.splitTextToSize(value, maxW - lw);
    doc.text(valLines[0] ?? "", M + lw, y + 4);
    y += 6;
    for (let i = 1; i < valLines.length; i++) {
      ensure(6);
      doc.text(valLines[i], M + lw, y + 4);
      y += 6;
    }
  }
  y += 4;

  // Résumé.
  if (f.synopsis) {
    ensure(10);
    doc.setDrawColor(220, 215, 205);
    doc.line(M, y, pageW - M, y);
    y += 7;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(154, 122, 18);
    doc.text(S.synopsis, M, y + 4);
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(11, 11, 12);
    for (const para of f.synopsis.split("\n")) {
      const lines = para.trim() === "" ? [""] : doc.splitTextToSize(para.trim(), maxW);
      for (const l of lines) {
        ensure(5.6);
        if (l !== "") doc.text(l, M, y + 4);
        y += 5.6;
      }
    }
  }

  // Pied.
  y += 6;
  ensure(10);
  doc.setDrawColor(220, 215, 205);
  doc.line(M, y, pageW - M, y);
  y += 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(11, 11, 12);
  doc.text("ÉDITIONS ÉCLOSION", M, y + 4);
  y += 6;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(S.tagline, M, y + 4);
  y += 7;
  // Signature discrète d'origine du partage.
  ensure(6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text(S.sharedVia, M, y + 3);

  const blob = doc.output("blob");
  return new File([blob], `${safeName(item)}-${lang}.pdf`, { type: "application/pdf" });
}

// Impression : couverture (image) + légende en TEXTE réel (sélectionnable).
export async function printCatalogueCard(item: CatalogueItem, lang: ShareLang): Promise<void> {
  const coverUrl = await loadCoverDataUrl(item);
  // Corps sans la signature : on la pose à part, petite et grise (style discret).
  const text = catalogueLegendText(item, lang, { signature: "none" });
  const signature = STRINGS[lang].sharedVia;
  const w = window.open("", "_blank", "noopener,width=820,height=1000");
  if (!w) throw new Error("Impossible d'ouvrir la fenêtre d'impression (fenêtres bloquées ?).");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(safeName(item))}</title>` +
      `<style>@page{margin:14mm}body{font-family:Arial,Helvetica,sans-serif;color:#0B0B0C;margin:0;line-height:1.5}` +
      `img{max-width:70%;max-height:95mm;display:block;margin:0 auto 14px}pre{white-space:pre-wrap;font-family:inherit;font-size:13px;margin:0}` +
      `.sig{margin-top:10px;font-size:9px;font-style:italic;color:#9A9A9A}</style></head>` +
      `<body>${coverUrl ? `<img src="${coverUrl}">` : ""}<pre>${esc(text)}</pre><div class="sig">${esc(signature)}</div>` +
      `<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},200)}</script></body></html>`,
  );
  w.document.close();
}
