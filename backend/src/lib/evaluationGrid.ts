import { prisma } from "./prisma.js";

// Grille d'évaluation EFFECTIVE pour un type de manuscrit (domaine) donné.
// Règle : si le domaine possède ses propres critères actifs, on les utilise ;
// sinon on retombe sur la grille PAR DÉFAUT (genreId null). Ainsi chaque type
// peut avoir sa grille, et ceux qui n'en ont pas héritent de la grille commune.
export async function effectiveCriteria(genreId: string | null | undefined) {
  const order = [{ coefficient: "desc" as const }, { label: "asc" as const }];
  if (genreId) {
    const own = await prisma.evaluationCriterion.findMany({ where: { isActive: true, genreId }, orderBy: order });
    if (own.length) return own;
  }
  return prisma.evaluationCriterion.findMany({ where: { isActive: true, genreId: null }, orderBy: order });
}
