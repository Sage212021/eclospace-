import { prisma } from "./prisma.js";

// Détection de doublon à l'enregistrement d'un manuscrit.
//
// Le titre est normalisé avant comparaison : insensible à la CASSE, aux
// ACCENTS, à la PONCTUATION, aux TRAITS D'UNION et aux ESPACES multiples. Ainsi
// « Management de la Santé du bien-être » et « management de la sante du bien
// être » sont reconnus comme le MÊME ouvrage. Une comparaison au caractère près
// (l'ancien comportement) laissait passer ces variantes et créait des doublons.
export function normalizeTitleForDuplicate(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // retire les accents (é → e, ç → c…)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ") // ponctuation, traits d'union… → espace
    .trim()
    .replace(/\s+/g, " ");
}

export type DuplicateMatch = {
  manuscriptNumber: string;
  title: string;
  statusLabel: string;
};

// Renvoie le manuscrit existant (non supprimé) dont le titre normalisé est
// identique, ou null. `db` permet de passer une transaction Prisma.
export async function findDuplicateManuscript(
  title: string,
  db: Pick<typeof prisma, "manuscript"> = prisma,
): Promise<DuplicateMatch | null> {
  const key = normalizeTitleForDuplicate(title);
  if (!key) return null;
  const candidates = await db.manuscript.findMany({
    where: { deletedAt: null },
    select: { manuscriptNumber: true, title: true, status: { select: { label: true } } },
  });
  const hit = candidates.find((c) => normalizeTitleForDuplicate(c.title) === key);
  return hit ? { manuscriptNumber: hit.manuscriptNumber, title: hit.title, statusLabel: hit.status.label } : null;
}

// Message 409 explicite et homogène pour les deux voies de création.
export function duplicateMessage(match: DuplicateMatch, requestedTitle: string): string {
  const base = `Un manuscrit « ${match.title.trim()} » est déjà enregistré sous ${match.manuscriptNumber} (étape : ${match.statusLabel}).`;
  const variante = normalizeTitleForDuplicate(match.title) === normalizeTitleForDuplicate(requestedTitle) && match.title.trim() !== requestedTitle.trim()
    ? " Le titre saisi n'en diffère que par la casse, les accents ou la ponctuation."
    : "";
  return `${base}${variante} Reprenez cette fiche, ou supprimez-la d'abord si vous voulez la ré-enregistrer.`;
}
