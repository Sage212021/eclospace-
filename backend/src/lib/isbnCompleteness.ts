import { prisma } from "./prisma.js";

// Règle métier partagée : complétude « ISBN & références » d'un manuscrit
// (Ch. 12). Un ouvrage est prêt à passer l'étape de validation des références
// lorsqu'il a son ISBN d'impression, un dépôt légal préparé, une fiche de
// métadonnées complète et une classification affectée.
//
// Cette fonction est consommée par plusieurs domaines (attribution ISBN,
// workflow, BAT) : elle vit donc dans la couche `lib/` (règles partagées) et
// non dans une route, conformément aux invariants d'architecture (voir
// `tests/architecture.test.ts`).
export async function computeIsbnCompleteness(manuscriptId: string): Promise<{ complete: boolean; missing: string[] }> {
  const [printIsbn, legalDeposits, metadata, manuscript] = await Promise.all([
    prisma.isbn.findFirst({ where: { manuscriptId, format: "print" } }),
    prisma.legalDeposit.findMany({ where: { manuscriptId } }),
    prisma.workMetadata.findUnique({ where: { manuscriptId } }),
    prisma.manuscript.findUnique({ where: { id: manuscriptId }, select: { genreId: true } }),
  ]);

  const missing: string[] = [];
  if (!printIsbn) missing.push("isbn_attribue");
  if (legalDeposits.length === 0) missing.push("depot_legal_prepare");
  if (!metadata || !metadata.summary || !metadata.weightGrams) missing.push("fiche_metadonnees_complete");
  // Classification affectée (décision opérateur 14/10) : le GENRE éditorial
  // (Roman, Essai, Poésie…) tient lieu de classification — il est toujours
  // renseigné par l'éditorial. Les codes Thema restent acceptés comme
  // alternative (classification internationale fine), mais ne sont plus exigés :
  // aucun écran ne permettait de les saisir, ce qui bloquait la validation.
  const classified = Boolean(manuscript?.genreId) || Boolean(metadata && metadata.themaCodes.length > 0);
  if (!classified) missing.push("classification_affectee");

  return { complete: missing.length === 0, missing };
}
