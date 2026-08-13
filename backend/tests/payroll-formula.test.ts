import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import { evaluateExpression, FormulaError, FORMULA_DEFS, FORMULA_BY_CODE, evalLeaf } from "../src/lib/payrollFormula.js";
import { computePayslip, type PayrollRates, type PayslipInput } from "../src/lib/payrollEngine.js";

const RATES: PayrollRates = {
  vidSal: 0.042, vidPat: 0.042, pf: 0.07, at: 0.025, cnpsCeiling: 750000,
  coefAssiette: 0.8, abatPct: 0.3, abatFixe: 500000, cacPct: 0.1,
  cfcSal: 0.01, cfcPat: 0.015, fne: 0.01, ancDefPct: 0.05,
  irpp: { p1: 2000000, t1: 0.1, p2: 3000000, t2: 0.15, p3: 5000000, t3: 0.25, t4: 0.35 },
  tcRav: { seuil1: 110000, tc1: 0, rav1: 1950, seuil2: 200000, tc2: 500, rav2: 1950, tc3: 750, rav3: 3250 },
};
// Assiette fiscale de l'échantillon serveur (voir FORMULA_SAMPLE dans la route).
const FORMULA_SAMPLE_FISCALE = 470000;
const INPUT: PayslipInput = {
  base: 300000, complements: 200000, fiscalBase: 500000, fiscalParts: 1, applyFiscalParts: true,
  seniorityYears: 3, seniorityRate: null, seniorityThreshold: 2, applySeniority: true,
  retenueAbsence: 0, internal: { avance: 0, pret: 0, retard: 0, autres: 0 },
};

// Évaluateur d'expressions SÛR — coeur critique de l'éditeur de formules.
describe("évaluateur de formules (sécurité + exactitude)", () => {
  it("évalue les opérateurs et la priorité", () => {
    expect(evaluateExpression("2 + 3 * 4", {})).toBe(14);
    expect(evaluateExpression("(2 + 3) * 4", {})).toBe(20);
    expect(evaluateExpression("10 - 2 - 3", {})).toBe(5); // associativité gauche
    expect(evaluateExpression("-5 + 2", {})).toBe(-3); // moins unaire
    expect(evaluateExpression("100 / 4 / 5", {})).toBe(5);
  });

  it("résout les variables de la liste blanche", () => {
    expect(evaluateExpression("assiette * taux", { assiette: 500000, taux: 0.042 })).toBe(21000);
    expect(evaluateExpression("base + complements", { base: 300000, complements: 50000 })).toBe(350000);
  });

  it("applique les fonctions min / max / round / floor / ceil / abs", () => {
    expect(evaluateExpression("round(0.042 * 500000)", {})).toBe(21000);
    expect(evaluateExpression("min(assiette, plafond)", { assiette: 900000, plafond: 750000 })).toBe(750000);
    expect(evaluateExpression("max(x - y, 0)", { x: 10, y: 40 })).toBe(0);
    expect(evaluateExpression("round(1234.6)", {})).toBe(1235);
    expect(evaluateExpression("floor(1234.9)", {})).toBe(1234);
    expect(evaluateExpression("ceil(1234.1)", {})).toBe(1235);
    expect(evaluateExpression("abs(0 - 7)", {})).toBe(7);
  });

  it("rejette une variable inconnue avec un message explicite", () => {
    expect(() => evaluateExpression("assiette * inconnue", { assiette: 1 })).toThrow(FormulaError);
    try {
      evaluateExpression("assiette * inconnue", { assiette: 1 });
    } catch (e) {
      expect((e as Error).message).toContain("inconnue");
    }
  });

  it("rejette toute tentative d'injection / caractère étranger", () => {
    for (const bad of ["process.exit(1)", "require('fs')", "1; DROP", "a === b", "2 ** 8", "`x`", "eval(1)"]) {
      expect(() => evaluateExpression(bad, { a: 1, b: 2 })).toThrow(FormulaError);
    }
  });

  it("rejette la division par zéro et les parenthèses déséquilibrées", () => {
    expect(() => evaluateExpression("1 / 0", {})).toThrow(/Division par zéro/);
    expect(() => evaluateExpression("(1 + 2", {})).toThrow(/Parenthèse/);
    expect(() => evaluateExpression("min(1, 2", {})).toThrow(/Parenthèse/);
  });

  it("rejette une fonction non listée", () => {
    expect(() => evaluateExpression("sqrt(4)", {})).toThrow(/Fonction inconnue/);
  });

  it("evalLeaf retombe sur la valeur par défaut si la formule est absente ou invalide", () => {
    // Pas de surcharge : renvoie le fallback.
    expect(evalLeaf("pvid_salarie", undefined, 21000, { assiette_cnps: 500000, taux_pvid_sal: 0.042 })).toBe(21000);
    // Surcharge invalide (variable inconnue) : NE casse PAS la paie, renvoie le fallback.
    expect(evalLeaf("pvid_salarie", { pvid_salarie: "assiette_cnps * inexistant" }, 21000, { assiette_cnps: 500000, taux_pvid_sal: 0.042 })).toBe(21000);
    // Surcharge valide : applique la formule.
    expect(evalLeaf("pvid_salarie", { pvid_salarie: "round(assiette_cnps * taux_pvid_sal)" }, 0, { assiette_cnps: 500000, taux_pvid_sal: 0.042 })).toBe(21000);
  });

  it("chaque formule par défaut est valide et se calcule (parité liste blanche)", () => {
    const sample: Record<string, number> = {
      base: 400000, complements: 50000, taux_anciennete: 0.05, prime_anciennete: 20000, retenue_absence: 0,
      assiette_cnps: 600000, assiette_fiscale: 470000,
      taux_pvid_sal: 0.042, taux_pvid_pat: 0.042, taux_pf: 0.07, taux_at: 0.03,
      taux_cfc_sal: 0.01, taux_cfc_pat: 0.015, taux_fne: 0.01,
    };
    for (const def of FORMULA_DEFS) {
      const v = evaluateExpression(def.defaultExpression, sample);
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("overlay de formules dans le moteur (parité + surcharge)", () => {
  it("PARITÉ : les formules par défaut reproduisent le calcul codé en dur au byte près", () => {
    const overlay = Object.fromEntries(FORMULA_DEFS.map((d) => [d.code, d.defaultExpression]));
    const sansOverlay = computePayslip(INPUT, RATES);
    const avecDefauts = computePayslip(INPUT, RATES, overlay);
    expect(avecDefauts).toEqual(sansOverlay);
  });

  it("sans overlay, comportement historique inchangé (undefined = codé en dur)", () => {
    const p = computePayslip(INPUT, RATES);
    expect(p.prime_anciennete).toBe(15000); // 300 000 × 5 %
    expect(p.pvid_salarie).toBe(Math.round(p.assiette_cnps * RATES.vidSal));
  });

  it("une formule personnalisée ne modifie QUE son élément", () => {
    const ref = computePayslip(INPUT, RATES);
    // PVID salarié à 5 % au lieu de 4,2 %.
    const p = computePayslip(INPUT, RATES, { pvid_salarie: "round(assiette_cnps * 0.05)" });
    expect(p.pvid_salarie).toBe(Math.round(p.assiette_cnps * 0.05));
    expect(p.pvid_salarie).not.toBe(ref.pvid_salarie);
    expect(p.pvid_patronal).toBe(ref.pvid_patronal); // inchangé
    expect(p.prestations_familiales).toBe(ref.prestations_familiales); // inchangé
    // Le total des retenues salariales suit la nouvelle PVID (et rien d'autre).
    expect(p.total_retenues_salariales).toBe(ref.total_retenues_salariales + (p.pvid_salarie - ref.pvid_salarie));
  });

  it("une formule invalide en production NE casse PAS la paie (retombe sur le défaut)", () => {
    const ref = computePayslip(INPUT, RATES);
    const p = computePayslip(INPUT, RATES, { pvid_salarie: "assiette_cnps * variable_inexistante" });
    expect(p.pvid_salarie).toBe(ref.pvid_salarie); // fallback codé en dur
  });
});

describe("API formules — liste, test, modification avec motif", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let plainCookie: string;
  // On teste sur « fne » (élément patronal, sans effet sur le net salarié) et on
  // le RÉINITIALISE en fin de suite pour ne pas polluer la base de test partagée.
  const CODE = "fne";

  beforeAll(async () => {
    app = await buildApp();
    const resA = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    adminCookie = extractSessionCookie(resA.cookies.map((c) => `${c.name}=${c.value}`));
    await createUserWithRole("formule_simple", "CORRECTEUR", "FormulePass123!");
    const resP = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "formule_simple", password: "FormulePass123!" } });
    plainCookie = extractSessionCookie(resP.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    // Réinitialisation systématique : la base de test est partagée.
    await prisma.payrollFormula.update({ where: { code: CODE }, data: { expression: FORMULA_BY_CODE[CODE].defaultExpression, custom: false, changeReason: null } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("refuse la liste des formules à un profil non habilité (403)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/payroll/formulas", headers: { cookie: plainCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("liste les formules avec expression, défaut et variables", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/payroll/formulas", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ code: string; expression: string; default_expression: string; variables: string[] }>;
    expect(rows.length).toBe(FORMULA_DEFS.length);
    const fne = rows.find((r) => r.code === CODE)!;
    expect(fne.default_expression).toBe("round(assiette_fiscale * taux_fne)");
    expect(fne.variables).toContain("assiette_fiscale");
  });

  it("teste une expression et renvoie résultat par défaut + proposé", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/payroll/formulas/${CODE}/test`, headers: { cookie: adminCookie }, payload: { expression: "round(assiette_fiscale * 0.02)" } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.ok).toBe(true);
    expect(b.default_result).toBe(Math.round(FORMULA_SAMPLE_FISCALE * 0.01));
    expect(b.result).toBe(Math.round(FORMULA_SAMPLE_FISCALE * 0.02));
  });

  it("signale une expression invalide au test (variable inconnue) sans erreur 500", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/payroll/formulas/${CODE}/test`, headers: { cookie: adminCookie }, payload: { expression: "assiette_fiscale * inconnue" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
    expect(res.json().error).toContain("inconnue");
  });

  it("refuse la modification SANS motif (400)", async () => {
    const res = await app.inject({ method: "PUT", url: `/api/v1/payroll/formulas/${CODE}`, headers: { cookie: adminCookie }, payload: { custom: true, expression: "round(assiette_fiscale * 0.02)" } });
    expect(res.statusCode).toBe(400);
  });

  it("refuse une expression invalide à l'enregistrement (400)", async () => {
    const res = await app.inject({ method: "PUT", url: `/api/v1/payroll/formulas/${CODE}`, headers: { cookie: adminCookie }, payload: { custom: true, expression: "assiette_fiscale * inconnue", change_reason: "essai" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_formula");
  });

  it("refuse la modification à un profil non habilité (403)", async () => {
    const res = await app.inject({ method: "PUT", url: `/api/v1/payroll/formulas/${CODE}`, headers: { cookie: plainCookie }, payload: { custom: true, expression: "round(assiette_fiscale * 0.02)", change_reason: "essai" } });
    expect(res.statusCode).toBe(403);
  });

  it("enregistre une formule personnalisée AVEC motif et la trace", async () => {
    const reason = `Test formule ${Date.now()}`;
    const put = await app.inject({ method: "PUT", url: `/api/v1/payroll/formulas/${CODE}`, headers: { cookie: adminCookie }, payload: { custom: true, expression: "round(assiette_fiscale * 0.02)", change_reason: reason } });
    expect(put.statusCode).toBe(200);
    expect(put.json().custom).toBe(true);
    expect(put.json().change_reason).toBe(reason);
    // Relecture : la personnalisation est persistée.
    const list = (await app.inject({ method: "GET", url: "/api/v1/payroll/formulas", headers: { cookie: adminCookie } })).json();
    expect(list.find((r: { code: string }) => r.code === CODE).expression).toBe("round(assiette_fiscale * 0.02)");
    // Réinitialisation au défaut.
    const reset = await app.inject({ method: "PUT", url: `/api/v1/payroll/formulas/${CODE}`, headers: { cookie: adminCookie }, payload: { custom: false, change_reason: "retour au défaut" } });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().custom).toBe(false);
    expect(reset.json().expression).toBe(FORMULA_BY_CODE[CODE].defaultExpression);
  });
});
