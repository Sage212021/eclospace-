import type { FastifyRequest } from "fastify";

// Correction d'un fichier déposé par erreur à une étape (demande opérateur
// 21/08/2026). Seuls peuvent retirer/remplacer un fichier : l'AUTEUR du dépôt
// (celui qui l'a chargé) et la DIRECTION (habilitations d'encadrement). Tous les
// dépôts restent en suppression LOGIQUE (Modèle §13) — rien n'est effacé
// physiquement, une nouvelle version/entrée peut toujours être ajoutée.

// Habilitations « direction » autorisées à corriger n'importe quel dépôt.
const DIRECTION_PERMS = ["manuscripts:validation", "manuscripts:administration", "production:administration"];

export function isDirection(request: FastifyRequest): boolean {
  const perms = request.user?.permissions;
  return perms ? DIRECTION_PERMS.some((p) => perms.has(p)) : false;
}

// L'utilisateur courant peut-il corriger ce dépôt ? (auteur OU direction)
export function canCorrectDeposit(request: FastifyRequest, uploaderId: string | null | undefined): boolean {
  return (uploaderId != null && uploaderId === request.user?.id) || isDirection(request);
}

// Titres des documents d'étape « uniques » (déposés/versionnés à une étape).
export const CORRECTED_DOC_TITLE = "Manuscrit corrigé";
export const LAYOUT_DOC_TITLE = "Maquette (mise en page)";
export const BAT_DOC_TITLE = "BAT signé";

// Un document est-il un LIVRABLE / une pièce d'étape que l'on peut retirer ?
// Liste blanche : pièces d'étape (livrable, cycle de correction, pièces jointes),
// maquette, BAT signé, manuscrit corrigé. On EXCLUT le fichier source du
// manuscrit (« Manuscrit (source) ») pour ne pas retirer l'original de l'auteur.
export function isDeletableStepDoc(doc: { category: string; title: string }): boolean {
  if (doc.category === "piece_etape") return true;
  if (doc.category === "livre_monte" && doc.title === LAYOUT_DOC_TITLE) return true;
  if (doc.category === "bat" && doc.title === BAT_DOC_TITLE) return true;
  if (doc.category === "manuscrit" && doc.title === CORRECTED_DOC_TITLE) return true;
  return false;
}
