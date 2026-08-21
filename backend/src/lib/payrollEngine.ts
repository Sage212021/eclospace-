// Moteur de calcul de paie (D-007, incrément 3) — fonctions PURES, testables.
// Réimplémentation FIDÈLE des formules du « Livre de paie » du classeur
// (docs/paie/), législation camerounaise. Montants en FCFA, arrondis à l'unité.

import { evalLeaf, type FormulaOverlay } from "./payrollFormula.js";
export type { FormulaOverlay } from "./payrollFormula.js";

export interface PayrollRates {
  vidSal: number;
  vidPat: number;
  pf: number;
  at: number;
  cnpsCeiling: number;
  coefAssiette: number;
  abatPct: number;
  abatFixe: number;
  cacPct: number;
  cfcSal: number;
  cfcPat: number;
  fne: number;
  ancDefPct: number;
  irpp: { p1: number; t1: number; p2: number; t2: number; p3: number; t3: number; t4: number };
  tcRav: { seuil1: number; tc1: number; rav1: number; seuil2: number; tc2: number; rav2: number; tc3: number; rav3: number };
  // Barème des avantages en nature (CGI art. 33), fractions du brut taxable.
  // Facultatif : absent ⇒ pas d'évaluation automatique (comportement historique).
  avantagesNature?: { logement: number; electricite: number; eau: number; domestique: number; vehicule: number; nourriture: number };
}

export interface PayslipInput {
  base: number; // salaire de base (D)
  complements: number; // compléments (E)
  fiscalBase: number; // assiette fiscale de référence (Employés!M ; défaut = brut contractuel)
  fiscalParts: number; // parts fiscales (Q)
  applyFiscalParts: boolean; // V
  seniorityYears: number; // R
  seniorityRate: number | null; // S (sinon taux par défaut du barème)
  seniorityThreshold: number; // T (seuil d'années)
  applySeniority: boolean; // U
  retenueAbsence: number; // G — retenue absence (issue du module Présences)
  internal: { avance: number; pret: number; retard: number; autres: number }; // V,W,X,Y
  // Rubriques « à option » activées (Niveau 2) — montants issus de rubriques du
  // catalogue, ventilés selon leur traitement légal (fiscal/CNPS). Facultatifs :
  // absents ⇒ comportement historique inchangé (aucun test/appel existant modifié).
  //  • rubriqueBrut      : rubriques payées en espèces, ajoutées au salaire brut.
  //  • rubriqueTaxable   : part entrant dans l'assiette FISCALE (IRPP/CFC/FNE).
  //  • rubriqueCotisable : part entrant dans l'assiette CNPS (avant plafond).
  rubriqueBrut?: number;
  rubriqueTaxable?: number;
  rubriqueCotisable?: number;
  // Avantages en nature évalués AU BARÈME (CGI art. 33) — exprimés en FRACTION du
  // salaire brut taxable (assiette fiscale « cœur »), car le barème est un % de ce
  // brut. Le moteur multiplie par sa propre assiette (autoritaire) : logement 15 %,
  // véhicule 10 %/véhicule, etc. L'avantage en nature n'est PAS payé en espèces : il
  // n'augmente donc pas le brut, seulement les assiettes fiscale et CNPS.
  //  • avantageNatureTaxablePct   : fraction entrant dans l'assiette FISCALE ;
  //  • avantageNatureCotisablePct : fraction entrant dans l'assiette CNPS.
  // Facultatifs, 0 par défaut ⇒ comportement historique strictement inchangé.
  avantageNatureTaxablePct?: number;
  avantageNatureCotisablePct?: number;
}

export interface Payslip {
  base: number;
  complements: number;
  prime_anciennete: number;
  retenue_absence: number;
  salaire_brut: number;
  assiette_fiscale: number;
  avantages_nature: number;
  cnps_cotisable_total: number;
  assiette_cnps: number;
  pvid_salarie: number;
  pvid_patronal: number;
  prestations_familiales: number;
  accidents_travail: number;
  cfc_salarie: number;
  cfc_patronal: number;
  fne: number;
  taxe_communale: number;
  rav: number;
  base_irpp_annuelle: number;
  irpp: number;
  irpp_cac: number;
  total_retenues_internes: number;
  total_retenues_salariales: number;
  total_charges_patronales: number;
  net_a_payer: number;
  cout_employeur: number;
}

const r = Math.round;

// IRPP annuel progressif (formule U du classeur), hors CAC.
function irppAnnuel(baseAnnuelle: number, i: PayrollRates["irpp"]): number {
  const { p1, t1, p2, t2, p3, t3, t4 } = i;
  if (baseAnnuelle <= p1) return baseAnnuelle * t1;
  if (baseAnnuelle <= p2) return p1 * t1 + (baseAnnuelle - p1) * t2;
  if (baseAnnuelle <= p3) return p1 * t1 + (p2 - p1) * t2 + (baseAnnuelle - p2) * t3;
  return p1 * t1 + (p2 - p1) * t2 + (p3 - p2) * t3 + (baseAnnuelle - p3) * t4;
}

// `formulas` (optionnel) : surcharges de formules définies par le RH (code →
// expression). En son absence, comportement historique CODÉ EN DUR, à l'octet
// près (aucun des tests/appels existants n'est modifié). Quand une surcharge
// existe pour un élément, sa formule remplace le calcul par défaut ; en cas
// d'erreur d'évaluation on retombe sur le défaut (jamais de paie cassée).
export function computePayslip(input: PayslipInput, rates: PayrollRates, formulas?: FormulaOverlay): Payslip {
  // F — prime d'ancienneté.
  let prime = 0;
  if (input.applySeniority && input.seniorityYears >= input.seniorityThreshold) {
    const rate = input.seniorityRate && input.seniorityRate > 0 ? input.seniorityRate : rates.ancDefPct;
    prime = evalLeaf("prime_anciennete", formulas, r(input.base * rate), {
      base: input.base, complements: input.complements, taux_anciennete: rate,
    });
  }

  // Rubriques activées (Niveau 2) — 0 par défaut ⇒ calcul historique inchangé.
  const rubBrut = input.rubriqueBrut ?? 0;
  const rubTaxable = input.rubriqueTaxable ?? 0;
  const rubCotisable = input.rubriqueCotisable ?? 0;

  // H — salaire brut. La retenue d'absence injustifiée réduit le brut (avant
  // impôt), comme dans le modèle moteur. Les rubriques payées en espèces s'y
  // ajoutent (après la formule de base, pour ne pas casser une éventuelle surcharge).
  const brut =
    evalLeaf("salaire_brut", formulas, Math.max(input.base + input.complements + prime - input.retenueAbsence, 0), {
      base: input.base, complements: input.complements, prime_anciennete: prime, retenue_absence: input.retenueAbsence,
    }) + rubBrut;

  // Avantages en nature évalués au barème (Niveau 2) — fraction du brut taxable.
  // Non payés en espèces ⇒ n'entrent pas dans le brut, seulement dans les assiettes.
  const anTaxPct = input.avantageNatureTaxablePct ?? 0;
  const anCotPct = input.avantageNatureCotisablePct ?? 0;

  // I — assiette fiscale : cœur (base fiscale + prime − retenue) + part imposable
  // des rubriques activées + avantages en nature au barème.
  const assietteFiscaleCore = Math.max(input.fiscalBase + prime - input.retenueAbsence, 0);
  const anTaxable = r(assietteFiscaleCore * anTaxPct);
  const anCotisable = r(assietteFiscaleCore * anCotPct);
  const assietteFiscale = assietteFiscaleCore + rubTaxable + anTaxable;

  // J — salaire cotisable CNPS : montant total (avant plafond) puis plafonné.
  // Le cœur suit le coefficient d'assiette (modèle historique) ; la part
  // cotisable des rubriques activées et des avantages en nature s'ajoute
  // explicitement (non re-coefficientée).
  const cnpsCotisableTotal = r(assietteFiscaleCore * rates.coefAssiette) + rubCotisable + anCotisable;
  const assietteCnps = Math.min(cnpsCotisableTotal, rates.cnpsCeiling);

  // K-N — cotisations CNPS sur l'assiette plafonnée.
  const pvidSal = evalLeaf("pvid_salarie", formulas, r(assietteCnps * rates.vidSal), { assiette_cnps: assietteCnps, taux_pvid_sal: rates.vidSal });
  const pvidPat = evalLeaf("pvid_patronal", formulas, r(assietteCnps * rates.vidPat), { assiette_cnps: assietteCnps, taux_pvid_pat: rates.vidPat });
  const pf = evalLeaf("prestations_familiales", formulas, r(assietteCnps * rates.pf), { assiette_cnps: assietteCnps, taux_pf: rates.pf });
  const at = evalLeaf("accidents_travail", formulas, r(assietteCnps * rates.at), { assiette_cnps: assietteCnps, taux_at: rates.at });

  // O-Q — CFC / FNE sur l'assiette fiscale.
  const cfcSal = evalLeaf("cfc_salarie", formulas, r(assietteFiscale * rates.cfcSal), { assiette_fiscale: assietteFiscale, taux_cfc_sal: rates.cfcSal });
  const cfcPat = evalLeaf("cfc_patronal", formulas, r(assietteFiscale * rates.cfcPat), { assiette_fiscale: assietteFiscale, taux_cfc_pat: rates.cfcPat });
  const fne = evalLeaf("fne", formulas, r(assietteFiscale * rates.fne), { assiette_fiscale: assietteFiscale, taux_fne: rates.fne });

  // R-S — taxe communale / RAV par tranches de brut.
  const tc = brut <= rates.tcRav.seuil1 ? rates.tcRav.tc1 : brut <= rates.tcRav.seuil2 ? rates.tcRav.tc2 : rates.tcRav.tc3;
  const rav = brut <= rates.tcRav.seuil1 ? rates.tcRav.rav1 : brut <= rates.tcRav.seuil2 ? rates.tcRav.rav2 : rates.tcRav.rav3;

  // T — base IRPP annuelle par part.
  const parts = input.applyFiscalParts ? Math.max(input.fiscalParts, 1) : 1;
  const baseIrppAnnuelle = Math.max(assietteFiscale * 12 * (1 - rates.abatPct) - rates.abatFixe, 0) / parts;

  // U — IRPP + CAC, mensualisé. On expose aussi l'IRPP seul (la colonne « IRPP »
  // du DIPE déclare l'impôt principal ; le CAC est une taxe communale distincte).
  const irppSeul = r(irppAnnuel(baseIrppAnnuelle, rates.irpp) / 12);
  const irppCac = r((irppAnnuel(baseIrppAnnuelle, rates.irpp) * (1 + rates.cacPct)) / 12);

  // Retenues internes (V-Y → Z).
  const totalInternes = input.internal.avance + input.internal.pret + input.internal.retard + input.internal.autres;

  // AA / AB.
  const totalRetenuesSal = pvidSal + cfcSal + tc + rav + irppCac;
  const totalChargesPat = pvidPat + pf + at + cfcPat + fne;

  return {
    base: input.base,
    complements: input.complements,
    prime_anciennete: prime,
    retenue_absence: input.retenueAbsence,
    salaire_brut: brut,
    assiette_fiscale: assietteFiscale,
    avantages_nature: anTaxable,
    cnps_cotisable_total: cnpsCotisableTotal,
    assiette_cnps: assietteCnps,
    pvid_salarie: pvidSal,
    pvid_patronal: pvidPat,
    prestations_familiales: pf,
    accidents_travail: at,
    cfc_salarie: cfcSal,
    cfc_patronal: cfcPat,
    fne,
    taxe_communale: tc,
    rav,
    base_irpp_annuelle: r(baseIrppAnnuelle),
    irpp: irppSeul,
    irpp_cac: irppCac,
    total_retenues_internes: totalInternes,
    total_retenues_salariales: totalRetenuesSal,
    total_charges_patronales: totalChargesPat,
    net_a_payer: brut - totalRetenuesSal - totalInternes,
    cout_employeur: brut + totalChargesPat,
  };
}
