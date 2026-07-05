import { prisma } from "./prisma.js";

// Convergence Maquette (Ch. 11) / Infographie (Ch. 12) : fiche technique de
// fabrication complète, dos non en attente de recalcul, couverture conforme
// et pourvue de ses droits iconographiques. Réutilisé par l'étape workflow
// INFOGRAPHIE (les deux modules avancent en parallèle mais convergent à cette
// étape) et par la constitution du dossier de BAT (Ch. 14 §14.2).
export async function checkMaquetteInfographieConvergence(manuscriptId: string): Promise<string[]> {
  const missing: string[] = [];

  const specs = await prisma.productionSpecs.findUnique({ where: { manuscriptId } });
  if (!specs || !specs.trimFormat || !specs.finalPages || !specs.paperInterior || !specs.paperCover || !specs.binding) {
    missing.push("fiche_technique_incomplete");
  }
  if (specs?.spineNeedsRecalc) missing.push("dos_a_recalculer");

  const cover = await prisma.imageAsset.findFirst({
    where: { manuscriptId, type: "couverture_1", technicalOk: true, rightsOrigin: { not: null } },
  });
  if (!cover) missing.push("couverture_non_conforme_ou_sans_droits");

  return missing;
}
