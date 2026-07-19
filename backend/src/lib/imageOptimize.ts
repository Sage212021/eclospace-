import { Jimp } from "jimp";

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
  const maxLongSide = opts.maxLongSide ?? 1600;
  const quality = opts.quality ?? 86;
  const format = opts.format ?? "jpeg";

  let image;
  try {
    image = await Jimp.read(input);
  } catch {
    throw new UnsupportedImageError();
  }

  const longSide = Math.max(image.width, image.height);
  if (longSide > maxLongSide) {
    // scaleToFit conserve les proportions et tient dans la boîte maxLongSide².
    image.scaleToFit({ w: maxLongSide, h: maxLongSide });
  }

  if (format === "png") {
    const buffer = await image.getBuffer("image/png");
    return { buffer, mime: "image/png", ext: "png" };
  }
  const buffer = await image.getBuffer("image/jpeg", { quality });
  return { buffer, mime: "image/jpeg", ext: "jpg" };
}
