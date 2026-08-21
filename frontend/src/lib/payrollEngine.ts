import type { PayrollRateSet, Payslip } from "../api/client";

// Moteur de calcul de paie — PORT FIDÈLE, côté navigateur, de
// `backend/src/lib/payrollEngine.ts`. Permet l'aperçu du bulletin EN DIRECT :
// dès qu'un pourcentage ou un montant change, le net à payer se recalcule
// instantanément (le serveur reste la référence au moment de l'enregistrement).
// Toute évolution des formules doit être répercutée des DEUX côtés.

export interface PayrollRates {
  vidSal: number; vidPat: number; pf: number; at: number; cnpsCeiling: number;
  coefAssiette: number; abatPct: number; abatFixe: number; cacPct: number;
  cfcSal: number; cfcPat: number; fne: number; ancDefPct: number;
  irpp: { p1: number; t1: number; p2: number; t2: number; p3: number; t3: number; t4: number };
  tcRav: { seuil1: number; tc1: number; rav1: number; seuil2: number; tc2: number; rav2: number; tc3: number; rav3: number };
}

export interface PayslipInput {
  base: number;
  complements: number;
  fiscalBase: number;
  fiscalParts: number;
  applyFiscalParts: boolean;
  seniorityYears: number;
  seniorityRate: number | null;
  seniorityThreshold: number;
  applySeniority: boolean;
  retenueAbsence: number;
  internal: { avance: number; pret: number; retard: number; autres: number };
  // Rubriques activées / avantages en nature (Niveau 2) — facultatifs, 0 par
  // défaut ⇒ calcul historique inchangé. Doivent rester jumeaux du moteur serveur.
  rubriqueBrut?: number;
  rubriqueTaxable?: number;
  rubriqueCotisable?: number;
  avantageNatureTaxablePct?: number;
  avantageNatureCotisablePct?: number;
}

const r = Math.round;

function irppAnnuel(baseAnnuelle: number, i: PayrollRates["irpp"]): number {
  const { p1, t1, p2, t2, p3, t3, t4 } = i;
  if (baseAnnuelle <= p1) return baseAnnuelle * t1;
  if (baseAnnuelle <= p2) return p1 * t1 + (baseAnnuelle - p1) * t2;
  if (baseAnnuelle <= p3) return p1 * t1 + (p2 - p1) * t2 + (baseAnnuelle - p2) * t3;
  return p1 * t1 + (p2 - p1) * t2 + (p3 - p2) * t3 + (baseAnnuelle - p3) * t4;
}

export function computePayslip(input: PayslipInput, rates: PayrollRates): Payslip {
  let prime = 0;
  if (input.applySeniority && input.seniorityYears >= input.seniorityThreshold) {
    const rate = input.seniorityRate && input.seniorityRate > 0 ? input.seniorityRate : rates.ancDefPct;
    prime = r(input.base * rate);
  }
  const rubBrut = input.rubriqueBrut ?? 0;
  const rubTaxable = input.rubriqueTaxable ?? 0;
  const rubCotisable = input.rubriqueCotisable ?? 0;
  const anTaxPct = input.avantageNatureTaxablePct ?? 0;
  const anCotPct = input.avantageNatureCotisablePct ?? 0;
  const brut = Math.max(input.base + input.complements + prime - input.retenueAbsence, 0) + rubBrut;
  const assietteFiscaleCore = Math.max(input.fiscalBase + prime - input.retenueAbsence, 0);
  const anTaxable = r(assietteFiscaleCore * anTaxPct);
  const anCotisable = r(assietteFiscaleCore * anCotPct);
  const assietteFiscale = assietteFiscaleCore + rubTaxable + anTaxable;
  const cnpsCotisableTotal = r(assietteFiscaleCore * rates.coefAssiette) + rubCotisable + anCotisable;
  const assietteCnps = Math.min(cnpsCotisableTotal, rates.cnpsCeiling);
  const pvidSal = r(assietteCnps * rates.vidSal);
  const pvidPat = r(assietteCnps * rates.vidPat);
  const pf = r(assietteCnps * rates.pf);
  const at = r(assietteCnps * rates.at);
  const cfcSal = r(assietteFiscale * rates.cfcSal);
  const cfcPat = r(assietteFiscale * rates.cfcPat);
  const fne = r(assietteFiscale * rates.fne);
  const tc = brut <= rates.tcRav.seuil1 ? rates.tcRav.tc1 : brut <= rates.tcRav.seuil2 ? rates.tcRav.tc2 : rates.tcRav.tc3;
  const rav = brut <= rates.tcRav.seuil1 ? rates.tcRav.rav1 : brut <= rates.tcRav.seuil2 ? rates.tcRav.rav2 : rates.tcRav.rav3;
  const parts = input.applyFiscalParts ? Math.max(input.fiscalParts, 1) : 1;
  const baseIrppAnnuelle = Math.max(assietteFiscale * 12 * (1 - rates.abatPct) - rates.abatFixe, 0) / parts;
  const irppSeul = r(irppAnnuel(baseIrppAnnuelle, rates.irpp) / 12);
  const irppCac = r((irppAnnuel(baseIrppAnnuelle, rates.irpp) * (1 + rates.cacPct)) / 12);
  const totalInternes = input.internal.avance + input.internal.pret + input.internal.retard + input.internal.autres;
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

// Barème (forme imbriquée de l'API) → taux du moteur.
export function ratesFromRateSet(rs: PayrollRateSet): PayrollRates {
  return {
    vidSal: rs.cnps.vid_sal_pct, vidPat: rs.cnps.vid_pat_pct, pf: rs.cnps.pf_pct, at: rs.cnps.at_pct, cnpsCeiling: rs.cnps.ceiling,
    coefAssiette: rs.misc.coef_assiette, abatPct: rs.fiscal.abat_pct, abatFixe: rs.fiscal.abat_fixe, cacPct: rs.fiscal.cac_pct,
    cfcSal: rs.fiscal.cfc_sal_pct, cfcPat: rs.fiscal.cfc_pat_pct, fne: rs.fiscal.fne_pct, ancDefPct: rs.misc.anc_def_pct,
    irpp: { p1: rs.irpp.t1_ceiling, t1: rs.irpp.t1_pct, p2: rs.irpp.t2_ceiling, t2: rs.irpp.t2_pct, p3: rs.irpp.t3_ceiling, t3: rs.irpp.t3_pct, t4: rs.irpp.t4_pct },
    tcRav: { seuil1: rs.tc_rav.seuil1, tc1: rs.tc_rav.tc1, rav1: rs.tc_rav.rav1, seuil2: rs.tc_rav.seuil2, tc2: rs.tc_rav.tc2, rav2: rs.tc_rav.rav2, tc3: rs.tc_rav.tc3, rav3: rs.tc_rav.rav3 },
  };
}
