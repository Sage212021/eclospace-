import { Jimp } from "jimp";
import { readStoredFile, readStoredFileOrNull, writeStoredFileAt } from "./storage.js";

// Optimisation d'image « prête pour le web » (couvertures à publier sur le site).
//
// Les couvertures déposées dans l'ERP sont en qualité impression (souvent
// plusieurs Mo, 3000+ px). Pour la publication sur le site vitrine, on ne veut
// PAS ce fichier lourd : on veut une image légère, déjà en JPG (ou PNG), de
// très bonne qualité d'affichage, prête à joindre à la fiche.
//
// Choix technique : « jimp » — bibliothèque image 100 % JavaScript (aucun
// binaire natif à compiler), qui s'installe et tourne partout de la même façon
// (poste, cloud Scaleway). Conforme à la règle « pas de dépendance exotique ».
// Détail dans docs/JOURNAL_TECHNIQUE.md.

// Un fichier source que jimp ne sait pas décoder (ex. PDF, format exotique).
export class UnsupportedImageError extends Error {
  constructor(message = "Format d'image non pris en charge pour l'optimisation.") {
    super(message);
    this.name = "UnsupportedImageError";
  }
}

export interface OptimizeOptions {
  // Plus grand côté (px) autorisé en sortie. On réduit seulement (jamais
  // d'agrandissement) : une image déjà plus petite garde ses dimensions.
  maxLongSide?: number;
  // Boîte cible (largeur × hauteur, px) : l'image est réduite pour TENIR dans
  // cette boîte, proportions conservées (aucune coupe, aucune déformation).
  // Utile pour caler une couverture sur le format portrait du site (≈ 2:3).
  // Prioritaire sur maxLongSide si les deux sont fournis.
  maxWidth?: number;
  maxHeight?: number;
  // Qualité JPEG (1–100). 86 = très bonne qualité, fichier léger.
  quality?: number;
  // Format de sortie. « jpeg » par défaut (le plus léger pour une couverture
  // photographique) ; « png » si l'on veut préserver une transparence.
  format?: "jpeg" | "png";
}

export interface OptimizedImage {
  buffer: Buffer;
  mime: string; // "image/jpeg" | "image/png"
  ext: string; // "jpg" | "png"
}

// Réduit et convertit une image en un fichier léger de très bonne qualité.
export async function optimizeImage(input: Buffer, opts: OptimizeOptions = {}): Promise<OptimizedImage> {
  const quality = opts.quality ?? 86;
  const format = opts.format ?? "jpeg";

  let image;
  try {
    image = await Jimp.read(input);
  } catch {
    throw new UnsupportedImageError();
  }

  // Boîte cible : soit (largeur × hauteur) explicite, soit un carré maxLongSide.
  const maxW = opts.maxWidth ?? opts.maxLongSide ?? 1600;
  const maxH = opts.maxHeight ?? opts.maxLongSide ?? 1600;

  // Réduction SEULE (jamais d'agrandissement) : facteur ≤ 1, proportions gardées.
  const scale = Math.min(maxW / image.width, maxH / image.height, 1);
  if (scale < 1) {
    image.resize({ w: Math.max(1, Math.round(image.width * scale)), h: Math.max(1, Math.round(image.height * scale)) });
  }

  if (format === "png") {
    const buffer = await image.getBuffer("image/png");
    return { buffer, mime: "image/png", ext: "png" };
  }
  const buffer = await image.getBuffer("image/jpeg", { quality });
  return { buffer, mime: "image/jpeg", ext: "jpg" };
}

// Suffixe de la clé d'une miniature, dérivée du fichier d'origine (aucune
// colonne en base : le chemin de la miniature = chemin d'origine + ce suffixe).
const THUMB_SUFFIX = ".thumb.jpg";

// Miniature (≈360 px, JPG léger) d'une image stockée, générée et MISE EN CACHE
// au premier accès : les aperçus et les listes n'ont plus à télécharger l'image
// pleine taille (souvent 1600 px / plusieurs centaines de Ko) — d'où un
// défilement bien plus fluide et beaucoup moins de mémoire sur les postes qui
// manipulent des images (infographistes). Le fichier d'origine reste intact
// (téléchargement / affichage en grand au clic).
export async function getOrCreateThumbnail(originalFilePath: string): Promise<{ buffer: Buffer; mime: string }> {
  const thumbPath = originalFilePath + THUMB_SUFFIX;
  const cached = await readStoredFileOrNull(thumbPath);
  if (cached) return { buffer: cached, mime: "image/jpeg" };

  const original = await readStoredFile(originalFilePath);
  const thumb = await optimizeImage(original, { maxLongSide: 360, quality: 78 });
  // Mise en cache au meilleur effort : un échec d'écriture ne bloque pas le
  // service de la miniature (elle sera simplement régénérée au prochain accès).
  await writeStoredFileAt(thumbPath, thumb.buffer).catch(() => undefined);
  return { buffer: thumb.buffer, mime: thumb.mime };
}
