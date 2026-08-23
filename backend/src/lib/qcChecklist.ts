// Contrôle qualité des exemplaires imprimés (Ch. 14 §14.7) : liste des points à
// vérifier à la réception d'un tirage. Catalogue unique, partagé par l'API (qui
// valide les codes soumis) et l'écran de saisie (qui affiche les cases à cocher).

export interface QcChecklistItemDef {
  code: string;
  label: string;
}

export const QC_CHECKLIST_ITEMS: QcChecklistItemDef[] = [
  { code: "couverture", label: "Couverture (impression, pelliculage, dos)" },
  { code: "faconnage", label: "Reliure / façonnage (collage, cahiers, solidité)" },
  { code: "colorimetrie", label: "Colorimétrie et rendu des couleurs" },
  { code: "pagination", label: "Pagination et complétude (pages manquantes ou inversées)" },
  { code: "coupe", label: "Massicot / coupe et alignement des pages" },
  { code: "papier", label: "Papier conforme (grammage, teinte)" },
];

export const QC_CHECKLIST_CODES = QC_CHECKLIST_ITEMS.map((i) => i.code);

export interface QcChecklistEntry {
  code: string;
  ok: boolean;
  note?: string;
}
