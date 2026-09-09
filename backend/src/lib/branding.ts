import { prisma } from "./prisma.js";

// Cachets et signature officiels de la maison (demande opérateur 09/09/2026),
// apposés automatiquement sur les documents sortants :
//   • cachet « Direction Éditoriale » → lettres de décision à l'auteur ;
//   • cachet « Direction Générale » + signature du DG → contrats d'auteur.
// Les images sont stockées en Data URL (PNG optimisé) dans un réglage unique, et
// sont remplaçables par l'administration (téléversement). Le nom et le titre du
// signataire, ainsi que l'interrupteur « apposer la signature du DG », sont aussi
// paramétrables.

export const BRANDING_KEY = "branding_stamps";

export type BrandingStampKey = "cachet_editoriale" | "cachet_generale" | "signature_dg";
export const BRANDING_STAMP_KEYS: BrandingStampKey[] = ["cachet_editoriale", "cachet_generale", "signature_dg"];

export interface Branding {
  cachet_editoriale: string | null; // data:image/png;base64,…
  cachet_generale: string | null;
  signature_dg: string | null;
  dg_name: string;
  dg_title: string;
  // Apposer automatiquement la signature du DG (en plus du cachet) sur les contrats.
  auto_sign_contracts: boolean;
}

// Nominatif du signataire (nom + qualité), imprimé sous la signature/cachet. Le
// titre peut tenir sur plusieurs lignes (séparées par des retours à la ligne).
export const BRANDING_DEFAULTS: Pick<Branding, "dg_name" | "dg_title" | "auto_sign_contracts"> = {
  dg_name: "Christelle Noah",
  dg_title: "Directeur Général de la Maison d'Édition Éclosion\nConsultante en Communication et aux Métiers de l'Édition",
  auto_sign_contracts: true,
};

export async function getBranding(): Promise<Branding> {
  const row = await prisma.setting.findUnique({ where: { key: BRANDING_KEY } });
  const v = (row?.value ?? {}) as Partial<Branding>;
  return {
    cachet_editoriale: typeof v.cachet_editoriale === "string" ? v.cachet_editoriale : null,
    cachet_generale: typeof v.cachet_generale === "string" ? v.cachet_generale : null,
    signature_dg: typeof v.signature_dg === "string" ? v.signature_dg : null,
    dg_name: (typeof v.dg_name === "string" && v.dg_name.trim()) || BRANDING_DEFAULTS.dg_name,
    dg_title: (typeof v.dg_title === "string" && v.dg_title.trim()) || BRANDING_DEFAULTS.dg_title,
    auto_sign_contracts: typeof v.auto_sign_contracts === "boolean" ? v.auto_sign_contracts : BRANDING_DEFAULTS.auto_sign_contracts,
  };
}

// Écrit une partie du réglage (fusion), en préservant les autres champs.
export async function patchBranding(patch: Partial<Branding>): Promise<Branding> {
  const current = await getBranding();
  const next: Branding = { ...current, ...patch };
  await prisma.setting.upsert({ where: { key: BRANDING_KEY }, update: { value: next as unknown as object }, create: { key: BRANDING_KEY, value: next as unknown as object } });
  return next;
}
