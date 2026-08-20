import type { AbsenceType } from "@prisma/client";

// Catalogue par défaut des motifs d'absence (demande opérateur 20/08/2026),
// aligné sur les types d'absence du droit du travail camerounais fournis par la
// direction. Semé (idempotent) par prisma/seed.ts et paramétrable ensuite par la
// RH/DG. Chaque motif porte ses règles :
//   • paid                 : payé (aucune retenue) ou non
//   • requiresJustification: un justificatif est attendu
//   • justificationDeadlineDays : délai de dépôt du justificatif (ex. 48 h)
//   • indicativeDaysMin/Max: durée indicative (aide à la saisie)
//   • decrementsLeave      : décompte le solde de congés (congé annuel)
//   • payrollDeductible    : génère une retenue de paie (absences non payées)
//   • isFault              : absence fautive (signalement RH/DG)
export interface AbsenceReasonSeed {
  code: string;
  label: string;
  category: AbsenceType;
  paid: boolean;
  requiresJustification: boolean;
  justificationDeadlineDays?: number | null;
  indicativeDaysMin?: number | null;
  indicativeDaysMax?: number | null;
  decrementsLeave: boolean;
  payrollDeductible: boolean;
  isFault: boolean;
  sortOrder: number;
}

const P = { paid: true, requiresJustification: true, decrementsLeave: false, payrollDeductible: false, isFault: false };

export const DEFAULT_ABSENCE_REASONS: AbsenceReasonSeed[] = [
  // 0 — Congé annuel (existant : décompte le solde).
  { code: "conge_annuel", label: "Congé annuel", category: "conge", ...P, requiresJustification: false, decrementsLeave: true, indicativeDaysMin: 1, indicativeDaysMax: null, sortOrder: 10 },

  // 1a — Permissions pour événements familiaux (payées).
  { code: "mariage_salarie", label: "Mariage du travailleur", category: "permission", ...P, indicativeDaysMin: 3, indicativeDaysMax: 4, sortOrder: 20 },
  { code: "mariage_enfant", label: "Mariage d'un enfant", category: "permission", ...P, indicativeDaysMin: 1, indicativeDaysMax: 2, sortOrder: 21 },
  { code: "naissance", label: "Naissance (congé de paternité)", category: "permission", ...P, indicativeDaysMin: 3, indicativeDaysMax: 3, sortOrder: 22 },
  { code: "deces_proche", label: "Décès du conjoint, d'un enfant ou d'un parent", category: "permission", ...P, indicativeDaysMin: 3, indicativeDaysMax: 4, sortOrder: 23 },
  { code: "deces_eloigne", label: "Décès d'un frère, d'une sœur ou d'un beau-parent", category: "permission", ...P, indicativeDaysMin: 1, indicativeDaysMax: 2, sortOrder: 24 },
  { code: "bapteme_communion", label: "Baptême / 1ère communion d'un enfant", category: "permission", ...P, indicativeDaysMin: 1, indicativeDaysMax: 1, sortOrder: 25 },

  // 1b — Autres permissions.
  { code: "permission_personnelle", label: "Permission exceptionnelle / personnelle", category: "permission", ...P, requiresJustification: false, indicativeDaysMin: null, indicativeDaysMax: 1, sortOrder: 30 },
  { code: "examen_concours", label: "Permission pour examen / concours", category: "permission", ...P, indicativeDaysMin: 1, indicativeDaysMax: 1, sortOrder: 31 },
  { code: "convocation_administrative", label: "Convocation administrative / entretien", category: "permission", ...P, indicativeDaysMin: 1, indicativeDaysMax: 1, sortOrder: 32 },

  // 2a — Maladie et assimilés (justifiés).
  { code: "maladie_certificat", label: "Maladie (certificat médical)", category: "maladie", ...P, justificationDeadlineDays: 2, sortOrder: 40 },
  { code: "maternite", label: "Congé de maternité (14 semaines)", category: "maladie", ...P, indicativeDaysMin: 98, indicativeDaysMax: 98, sortOrder: 41 },
  { code: "accident_travail", label: "Accident du travail / maladie professionnelle", category: "maladie", ...P, sortOrder: 42 },

  // 2b — Suspensions du contrat (non payées).
  { code: "mise_a_pied", label: "Mise à pied", category: "suspension", paid: false, requiresJustification: false, decrementsLeave: false, payrollDeductible: true, isFault: false, sortOrder: 50 },
  { code: "chomage_technique", label: "Chômage technique", category: "suspension", paid: false, requiresJustification: false, decrementsLeave: false, payrollDeductible: true, isFault: false, sortOrder: 51 },

  // 3 — Absences injustifiées / fautes (non payées, signalées).
  { code: "absence_injustifiee", label: "Absence sans autorisation ni justificatif", category: "injustifiee", paid: false, requiresJustification: false, decrementsLeave: false, payrollDeductible: true, isFault: true, sortOrder: 60 },
  { code: "abandon_poste", label: "Abandon de poste", category: "injustifiee", paid: false, requiresJustification: false, decrementsLeave: false, payrollDeductible: true, isFault: true, sortOrder: 61 },
  { code: "retard_repete", label: "Retard répété sans motif", category: "injustifiee", paid: false, requiresJustification: false, decrementsLeave: false, payrollDeductible: false, isFault: true, sortOrder: 62 },

  // Mission / télétravail (existants) — un motif générique pour la traçabilité.
  { code: "mission_ordre", label: "Mission (ordre de mission)", category: "mission", ...P, requiresJustification: false, sortOrder: 70 },
  { code: "teletravail_planifie", label: "Télétravail planifié", category: "teletravail", ...P, requiresJustification: false, sortOrder: 71 },
];

// Libellés lisibles des catégories (pour l'écran et les regroupements).
export const ABSENCE_CATEGORY_LABELS: Record<AbsenceType, string> = {
  conge: "Congé",
  permission: "Permission (congé court payé)",
  maladie: "Maladie / absence justifiée",
  suspension: "Suspension (non payée)",
  injustifiee: "Absence injustifiée / faute",
  mission: "Mission",
  teletravail: "Télétravail",
};
