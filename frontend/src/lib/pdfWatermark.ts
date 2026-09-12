import type { jsPDF } from "jspdf";
import { ECLOSION_FILIGRANE_JPG, ECLOSION_FILIGRANE_RATIO } from "./watermarkAsset";

// Filigrane « ampoule-livre » Éclosion, centré et discret, commun à TOUS les
// documents PDF officiels (demande opérateur 12/09/2026). À appeler au début de
// chaque page (avant d'écrire le contenu) pour rester DERRIÈRE le texte.
export function drawWatermark(doc: jsPDF): void {
  try {
    const w = 104;
    const h = w / ECLOSION_FILIGRANE_RATIO;
    doc.addImage(ECLOSION_FILIGRANE_JPG, "JPEG", (210 - w) / 2, (297 - h) / 2, w, h, "eclWm", "FAST");
  } catch {
    /* filigrane indisponible : on continue sans */
  }
}
