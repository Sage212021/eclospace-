import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { HOUSE } from "./print";

// Tampon « papier à en-tête » Éclosion appliqué à un PDF côté navigateur, aux
// couleurs de la charte « Noir souverain » (D-022) : logo en haut à gauche,
// coordonnées de la maison à droite, filet noir souligné d'or, mentions légales
// en pied, et ampoule Éclosion en filigrane très léger. Aucun bleu.
//
// Sert à imprimer sur papier à en-tête NUMÉRIQUE (fond reproduit à l'impression)
// un document qui n'a pas été produit par l'ERP — typiquement le rapport de
// lecture DÉPOSÉ par le relecteur (fichier PDF ou image).

// A4 en points PDF.
export const A4 = { w: 595.28, h: 841.89 };
// Zone d'en-tête (haut) et de pied (bas) réservées ; le contenu déposé est placé
// entre les deux, mis à l'échelle sans jamais chevaucher en-tête ni pied.
const HEADER_H = 118; // hauteur réservée en haut
const FOOTER_H = 52; // hauteur réservée en bas
const SIDE = 42; // marge latérale

const NOIR = rgb(0.043, 0.043, 0.047);
const OR = rgb(0.851, 0.698, 0.102);
const GREY = rgb(0.36, 0.39, 0.45);

export interface LetterheadContext {
  stamp: (page: PDFPage) => void;
  // Cadre utile pour poser le contenu déposé (coordonnées PDF, origine en bas).
  content: { x: number; y: number; w: number; h: number };
}

async function fetchAsset(path: string): Promise<Uint8Array | null> {
  try {
    const resp = await fetch(`${window.location.origin}${path}`);
    if (!resp.ok) return null;
    return new Uint8Array(await resp.arrayBuffer());
  } catch {
    return null;
  }
}

// Prépare le contexte (assets + polices chargés une seule fois) puis fournit une
// fonction `stamp(page)` à appliquer à chaque page A4 du document fusionné.
export async function createLetterheadContext(doc: PDFDocument): Promise<LetterheadContext> {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let logo: PDFImage | null = null;
  const logoBytes = await fetchAsset("/eclosion-logo.png");
  if (logoBytes) {
    try { logo = await doc.embedPng(logoBytes); } catch { logo = null; }
  }
  let wm: PDFImage | null = null;
  const wmBytes = await fetchAsset("/eclosion-filigrane-livre.png");
  if (wmBytes) {
    try { wm = await doc.embedPng(wmBytes); } catch { wm = null; }
  }

  const contactLines = [
    HOUSE.address,
    `${HOUSE.poBox} · Tél. ${HOUSE.phone}`,
    `${HOUSE.email} · ${HOUSE.website}`,
  ];
  const legal = `${HOUSE.legalName} · RCCM : ${HOUSE.rccm} · NIU : ${HOUSE.niu} · N° Affil. CNPS : ${HOUSE.cnps}`;

  const stamp = (page: PDFPage) => {
    const { width, height } = page.getSize();

    // Filigrane (ampoule) centré, très léger — imprimé derrière le contenu.
    if (wm) {
      const wmW = width * 0.52;
      const wmH = (wm.height / wm.width) * wmW;
      page.drawImage(wm, { x: (width - wmW) / 2, y: (height - wmH) / 2, width: wmW, height: wmH, opacity: 0.06 });
    }

    // Logo en haut à gauche (ratio respecté, ~120 pt de large).
    if (logo) {
      const lw = 120;
      const lh = (logo.height / logo.width) * lw;
      page.drawImage(logo, { x: SIDE, y: height - 26 - lh, width: lw, height: lh });
    }

    // Coordonnées de la maison, à droite, en gris discret.
    const size = 7.5;
    contactLines.forEach((line, i) => {
      const w = font.widthOfTextAtSize(line, size);
      page.drawText(line, { x: width - SIDE - w, y: height - 30 - i * 10, size, font, color: GREY });
    });

    // Filet noir souligné d'or, sous l'en-tête.
    const ruleY = height - HEADER_H + 14;
    page.drawRectangle({ x: SIDE, y: ruleY, width: width - 2 * SIDE, height: 2, color: NOIR });
    page.drawRectangle({ x: SIDE, y: ruleY - 3, width: (width - 2 * SIDE) * 0.4, height: 1.5, color: OR });

    // Pied de page légal.
    page.drawText(legal, { x: SIDE, y: FOOTER_H - 20, size: 6.8, font, color: GREY });
    page.drawRectangle({ x: SIDE, y: FOOTER_H - 6, width: width - 2 * SIDE, height: 0.6, color: rgb(0.905, 0.885, 0.83) });
    void fontBold;
  };

  return {
    stamp,
    content: { x: SIDE, y: FOOTER_H, w: A4.w - 2 * SIDE, h: A4.h - HEADER_H - FOOTER_H },
  };
}
