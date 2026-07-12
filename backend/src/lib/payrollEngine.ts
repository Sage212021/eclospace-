// Moteur de calcul de paie (D-007, incrément 3) — fonctions PURES, testables.
// Réimplémentation FIDÈLE des formules du « Livre de paie » du classeur
// (docs/paie/), législation camerounaise. Montants en FCFA, arrondis à l'unité.

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
}

export interface Payslip {
  base: number;
  complements: number;
  prime_anciennete: number;
  retenue_absence: number;
  salaire_brut: number;
  assiette_fiscale: number;
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

export function computePayslip(input: PayslipInput, rates: PayrollRates): Payslip {
  // F — prime d'ancienneté.
  let prime = 0;
  if (input.applySeniority && input.seniorityYears >= input.seniorityThreshold) {
    const rate = input.seniorityRate && input.seniorityRate > 0 ? input.seniorityRate : rates.ancDefPct;
    prime = r(input.base * rate);
  }

  // H — salaire brut.
  const brut = Math.max(input.base + input.complements + prime - input.retenueAbsence, 0);

  // I — assiette fiscale (base fiscale + prime − retenue absence).
  const assietteFiscale = Math.max(input.fiscalBase + prime - input.retenueAbsence, 0);

  // J — assiette CNPS plafonnée.
  const assietteCnps = Math.min(r(assietteFiscale * rates.coefAssiette), rates.cnpsCeiling);

  // K-N — cotisations CNPS sur l'assiette plafonnée.
  const pvidSal = r(assietteCnps * rates.vidSal);
  const pvidPat = r(assietteCnps * rates.vidPat);
  const pf = r(assietteCnps * rates.pf);
  const at = r(assietteCnps * rates.at);

  // O-Q — CFC / FNE sur l'assiette fiscale.
  const cfcSal = r(assietteFiscale * rates.cfcSal);
  const cfcPat = r(assietteFiscale * rates.cfcPat);
  const fne = r(assietteFiscale * rates.fne);

  // R-S — taxe communale / RAV par tranches de brut.
  const tc = brut <= rates.tcRav.seuil1 ? rates.tcRav.tc1 : brut <= rates.tcRav.seuil2 ? rates.tcRav.tc2 : rates.tcRav.tc3;
  const rav = brut <= rates.tcRav.seuil1 ? rates.tcRav.rav1 : brut <= rates.tcRav.seuil2 ? rates.tcRav.rav2 : rates.tcRav.rav3;

  // T — base IRPP annuelle par part.
  const parts = input.applyFiscalParts ? Math.max(input.fiscalParts, 1) : 1;
  const baseIrppAnnuelle = Math.max(assietteFiscale * 12 * (1 - rates.abatPct) - rates.abatFixe, 0) / parts;

  // U — IRPP + CAC, mensualisé.
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
    irpp_cac: irppCac,
    total_retenues_internes: totalInternes,
    total_retenues_salariales: totalRetenuesSal,
    total_charges_patronales: totalChargesPat,
    net_a_payer: brut - totalRetenuesSal - totalInternes,
    cout_employeur: brut + totalChargesPat,
  };
}
