import { describe, expect, it } from "vitest";
import { computePayslip as computeBack, type PayrollRates } from "../src/lib/payrollEngine.js";
// Port navigateur du moteur (aperçu du bulletin en direct). Son unique import est
// `import type … from "../api/client"` (effacé à l'exécution) : importable ici.
import { computePayslip as computeFront } from "../../frontend/src/lib/payrollEngine.ts";

// Garde-fou : le moteur porté côté navigateur (aperçu « net en direct ») doit
// donner EXACTEMENT le même bulletin que le moteur serveur (référence). Toute
// divergence de formule casse ce test — les deux fichiers doivent rester jumeaux.

const RATES: PayrollRates = {
  vidSal: 0.042, vidPat: 0.049, pf: 0.07, at: 0.0175, cnpsCeiling: 750000,
  coefAssiette: 1, abatPct: 0.3, abatFixe: 500000, cacPct: 0.1,
  cfcSal: 0.01, cfcPat: 0.015, fne: 0.01, ancDefPct: 0.02,
  irpp: { p1: 2000000, t1: 0.1, p2: 3000000, t2: 0.15, p3: 5000000, t3: 0.25, t4: 0.35 },
  tcRav: { seuil1: 62000, tc1: 0, rav1: 750, seuil2: 100000, tc2: 3000, rav2: 1300, tc3: 5000, rav3: 3000 },
};

function input(over: Partial<Parameters<typeof computeBack>[0]> = {}) {
  return {
    base: 300000, complements: 200000, fiscalBase: 500000, fiscalParts: 2,
    applyFiscalParts: true, seniorityYears: 6, seniorityRate: null, seniorityThreshold: 2,
    applySeniority: true, retenueAbsence: 0,
    internal: { avance: 0, pret: 0, retard: 0, autres: 0 },
    ...over,
  };
}

describe("parité moteur de paie navigateur ↔ serveur", () => {
  const cases = [
    input(),
    input({ applySeniority: false }),
    input({ base: 90000, complements: 10000, fiscalBase: 100000, fiscalParts: 1 }),
    input({ base: 2000000, complements: 1000000, fiscalBase: 3000000, fiscalParts: 3, seniorityYears: 20 }),
    input({ retenueAbsence: 75000 }),
    input({ applyFiscalParts: false, fiscalParts: 4 }),
  ];
  it.each(cases.map((c, i) => [i, c] as const))("cas %i : net et lignes identiques", (_i, c) => {
    expect(computeFront(c, RATES)).toEqual(computeBack(c, RATES));
  });
});
