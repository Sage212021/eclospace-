// Catalogue des éléments de salaire et leur traitement FISCAL (IRPP) et CNPS,
// d'après la « Procédure fiscale de traitement des salaires » (CGI, Ordonnance
// CNPS n°73/17, arrêtés et circulaires) fournie par la direction le 21/08/2026.
// Sert de RÉFÉRENTIEL / guide au RH (Niveau 1). Semé de façon idempotente ; les
// statuts restent modifiables dans les Paramètres (paramétrable, tracé).
//
// ⚠️ Plusieurs cas fins (indemnité de préavis, licenciement, usage véhicule,
// jetons de présence…) doivent être VALIDÉS par le comptable/juriste de la
// maison (conformité = responsabilité de la maison, décision D-007). Les
// statuts ci-dessous sont la meilleure lecture du document, éditables ensuite.

export type FiscalStatus = "taxable" | "non_taxable" | "partiel";
export type CnpsStatus = "cotisable" | "non_cotisable" | "partiel";

export interface SalaryElementSeed {
  code: string;
  label: string;
  category: string; // principal | accessoire_imposable | accessoire_exonere | accessoire_partiel | indemnite_rupture | prestation_diverse | avantage_nature
  fiscalStatus: FiscalStatus;
  cnpsStatus: CnpsStatus;
  legalRef: string;
  sortOrder: number;
}

export const SALARY_ELEMENT_CATEGORY_LABELS: Record<string, string> = {
  principal: "Principal du salaire",
  accessoire_imposable: "Accessoires imposables",
  accessoire_exonere: "Accessoires exonérés",
  accessoire_partiel: "Accessoires partiellement exonérés",
  indemnite_rupture: "Derniers droits / indemnités de rupture",
  prestation_diverse: "Prestations diverses",
  avantage_nature: "Avantages en nature",
};

export const FISCAL_STATUS_LABELS: Record<FiscalStatus, string> = {
  taxable: "Taxable",
  non_taxable: "Non taxable",
  partiel: "Partiellement taxable",
};

export const CNPS_STATUS_LABELS: Record<CnpsStatus, string> = {
  cotisable: "Cotisable",
  non_cotisable: "Non cotisable",
  partiel: "Partiellement cotisable",
};

const S = (
  code: string,
  label: string,
  category: string,
  fiscalStatus: FiscalStatus,
  cnpsStatus: CnpsStatus,
  legalRef: string,
  sortOrder: number,
): SalaryElementSeed => ({ code, label, category, fiscalStatus, cnpsStatus, legalRef, sortOrder });

export const DEFAULT_SALARY_ELEMENTS: SalaryElementSeed[] = [
  // Principal.
  S("salaire_base", "Salaire de base", "principal", "taxable", "cotisable", "CGI art. 30 ; Ord. 73/17 art. 7", 10),
  S("heures_sup", "Heures supplémentaires", "principal", "taxable", "cotisable", "CGI art. 30 ; Ord. 73/17 art. 7", 20),
  // Accessoires imposables (3–13).
  S("prime_anciennete", "Prime d'ancienneté", "accessoire_imposable", "taxable", "cotisable", "CGI art. 30 ; Ord. 73/17 art. 7", 30),
  S("prime_caisse", "Prime de caisse", "accessoire_imposable", "taxable", "cotisable", "CGI art. 30 ; Ord. 73/17 art. 7", 40),
  S("prime_magasin", "Prime de magasin", "accessoire_imposable", "taxable", "cotisable", "CGI art. 30 ; Ord. 73/17 art. 7", 50),
  S("prime_assiduite", "Prime d'assiduité", "accessoire_imposable", "taxable", "cotisable", "CGI art. 30 ; Ord. 73/17 art. 7", 60),
  S("prime_rendement", "Prime de rendement", "accessoire_imposable", "taxable", "cotisable", "CGI art. 30 ; Ord. 73/17 art. 7", 70),
  S("prime_sujetion_gestion", "Prime de sujétion-gestion", "accessoire_imposable", "taxable", "cotisable", "CGI art. 30 ; Ord. 73/17 art. 7", 80),
  S("gratifications", "Gratifications", "accessoire_imposable", "taxable", "cotisable", "CGI art. 30 ; Ord. 73/17 art. 7", 90),
  S("conges_payes", "Congés payés", "accessoire_imposable", "taxable", "cotisable", "CGI art. 30 ; Lettre-circ. CNPS 021/91", 100),
  S("rappels_salaire", "Rappels de salaire", "accessoire_imposable", "taxable", "cotisable", "CGI art. 30 ; Ord. 73/17 art. 7", 110),
  S("prime_bilan", "Prime de bilan", "accessoire_imposable", "taxable", "cotisable", "CGI art. 30 ; Ord. 73/17 art. 7", 120),
  S("prime_technicite", "Prime de technicité", "accessoire_imposable", "taxable", "cotisable", "CGI art. 30 ; Ord. 73/17 art. 7", 130),
  // Accessoires exonérés (14–20).
  S("indemnite_representation", "Indemnité de représentation", "accessoire_exonere", "non_taxable", "non_cotisable", "CGI art. 31 al. 1 ; Arrêté interm. 003 (1974)", 140),
  S("prime_salissure", "Prime de salissure", "accessoire_exonere", "non_taxable", "non_cotisable", "CGI art. 31 al. 1 ; Arrêté 003", 150),
  S("prime_risque", "Prime de risque", "accessoire_exonere", "non_taxable", "non_cotisable", "CGI art. 31 al. 1 ; Arrêté 003", 160),
  S("indemnite_usage_vehicule", "Indemnité d'usage véhicule/engin personnel", "accessoire_exonere", "non_taxable", "non_cotisable", "CGI art. 31 al. 1 (statut CNPS à valider)", 170),
  S("prime_outillage", "Prime d'outillage", "accessoire_exonere", "non_taxable", "non_cotisable", "CGI art. 31 al. 1 ; Arrêté 003", 180),
  S("indemnite_deplacement", "Indemnité de déplacement", "accessoire_exonere", "non_taxable", "non_cotisable", "CGI art. 31 al. 1 ; Arrêté 003", 190),
  S("prime_panier", "Prime de panier", "accessoire_exonere", "non_taxable", "non_cotisable", "CGI art. 31 al. 1 ; Arrêté 003", 200),
  // Accessoires partiellement exonérés (21–22).
  S("indemnite_espece_avantage_nature", "Indemnité en espèces représentative d'avantages en nature", "accessoire_partiel", "partiel", "partiel", "CGI art. 33 (réintégrée dans la limite du barème)", 210),
  S("prime_transport", "Prime de transport", "accessoire_partiel", "non_taxable", "non_cotisable", "CGI art. 31 al. 1 ; Arrêté 003", 220),
  // Derniers droits / indemnités de rupture (23–29).
  S("indemnite_fin_carriere", "Indemnité de fin de carrière", "indemnite_rupture", "taxable", "non_cotisable", "CGI art. 30 ; Lettre-circ. CNPS 021/91", 230),
  S("prime_bonne_separation", "Prime de bonne séparation", "indemnite_rupture", "taxable", "non_cotisable", "CGI art. 30 ; circ. CNPS 021/91", 240),
  S("prestation_deces", "Prestations lors du décès d'un salarié", "indemnite_rupture", "non_taxable", "non_cotisable", "CGI art. 31 al. 9 ; circ. CNPS 021/91", 250),
  S("indemnite_licenciement", "Indemnité de licenciement", "indemnite_rupture", "partiel", "non_cotisable", "CGI art. 31 al. 12 (quote-part dommages-intérêts exonérée) ; circ. 021/91", 260),
  S("indemnite_rupture_abusive", "Indemnité de rupture abusive du contrat", "indemnite_rupture", "non_taxable", "non_cotisable", "Dommages-intérêts (licenciement injustifié) ; circ. 021/91", 270),
  S("indemnite_reconversion", "Indemnité de reconversion", "indemnite_rupture", "taxable", "non_cotisable", "CGI art. 30 ; circ. CNPS 021/91", 280),
  S("indemnite_preavis", "Indemnité de préavis", "indemnite_rupture", "taxable", "cotisable", "CGI art. 30 : régime du salaire (taxable ET cotisable)", 290),
  // Prestations diverses (30–35).
  S("treizieme_mois", "Treizième mois", "prestation_diverse", "taxable", "cotisable", "CGI art. 30 ; Ord. 73/17 art. 7 al. 2", 300),
  S("prime_installation", "Prime d'installation", "prestation_diverse", "taxable", "cotisable", "CGI art. 30 ; Ord. 73/17 art. 7 al. 2", 310),
  S("prime_fonction", "Prime de fonction", "prestation_diverse", "taxable", "cotisable", "CGI art. 30 ; Ord. 73/17 art. 7 al. 2", 320),
  S("medaille_honneur", "Médaille d'honneur du travail", "prestation_diverse", "non_taxable", "non_cotisable", "CGI art. 31 al. 11 (caractère social)", 330),
  S("prime_credit_scolaire", "Prime de crédit scolaire", "prestation_diverse", "non_taxable", "non_cotisable", "Caractère social", 340),
  S("prime_urgence", "Prime d'urgence", "prestation_diverse", "non_taxable", "non_cotisable", "Caractère social ; Arrêté 003", 350),
  // Avantages en nature (36) + jetons (37).
  S("avantages_nature", "Avantages en nature (logement, véhicule, eau…)", "avantage_nature", "taxable", "cotisable", "CGI art. 33 (barème) ; Ord. 73/17 art. 7", 360),
  S("jetons_presence", "Jetons de présence", "prestation_diverse", "taxable", "non_cotisable", "CGI art. 7 A-1-b (déductibles si rémunèrent un travail effectif)", 370),
];
