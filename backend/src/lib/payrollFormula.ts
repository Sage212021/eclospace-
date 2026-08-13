// Éditeur de formules de paie (D-007) — évaluateur d'expressions SÛR.
//
// Le RH peut modifier la formule de calcul de certains éléments du bulletin
// (cotisations « assiette × taux », salaire brut, prime d'ancienneté). Un mauvais
// calcul se répercuterait sur toutes les paies : cet évaluateur est donc
// volontairement MINIMAL et SANS `eval`/`Function` — un simple analyseur
// descendant qui n'accepte que :
//   • nombres décimaux (2000000, 0.042, 1)                                   ;
//   • variables d'une LISTE BLANCHE fournie par l'appelant                    ;
//   • opérateurs + - * / et parenthèses, moins unaire                         ;
//   • fonctions min, max, round, floor, ceil, abs.
// Toute autre entrée (identifiant inconnu, appel de fonction non listé,
// caractère étranger) lève une erreur EXPLICITE en français.

export class FormulaError extends Error {}

type Ctx = Record<string, number>;

const FUNCS: Record<string, (args: number[]) => number> = {
  min: (a) => Math.min(...a),
  max: (a) => Math.max(...a),
  round: (a) => Math.round(a[0] ?? 0),
  floor: (a) => Math.floor(a[0] ?? 0),
  ceil: (a) => Math.ceil(a[0] ?? 0),
  abs: (a) => Math.abs(a[0] ?? 0),
};

// ── Analyseur descendant récursif ──────────────────────────────────────────
type Tok = { type: "num" | "id" | "op" | "paren" | "comma"; value: string };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c >= "0" && c <= "9") {
      let j = i + 1;
      while (j < src.length && ((src[j] >= "0" && src[j] <= "9") || src[j] === ".")) j++;
      toks.push({ type: "num", value: src.slice(i, j) });
      i = j;
      continue;
    }
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_") {
      let j = i + 1;
      while (j < src.length && ((src[j] >= "a" && src[j] <= "z") || (src[j] >= "A" && src[j] <= "Z") || (src[j] >= "0" && src[j] <= "9") || src[j] === "_")) j++;
      toks.push({ type: "id", value: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/") { toks.push({ type: "op", value: c }); i++; continue; }
    if (c === "(" || c === ")") { toks.push({ type: "paren", value: c }); i++; continue; }
    if (c === ",") { toks.push({ type: "comma", value: "," }); i++; continue; }
    throw new FormulaError(`Caractère non autorisé dans la formule : « ${c} ».`);
  }
  return toks;
}

/**
 * Évalue `src` avec les variables de `ctx` (liste blanche). Lève `FormulaError`
 * avec un message clair si la formule est invalide (variable inconnue, division
 * par zéro, parenthèses déséquilibrées…).
 */
export function evaluateExpression(src: string, ctx: Ctx): number {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];

  function parseExpr(): number {
    let v = parseTerm();
    while (peek() && peek().type === "op" && (peek().value === "+" || peek().value === "-")) {
      const op = next().value;
      const rhs = parseTerm();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseUnary();
    while (peek() && peek().type === "op" && (peek().value === "*" || peek().value === "/")) {
      const op = next().value;
      const rhs = parseUnary();
      if (op === "/") {
        if (rhs === 0) throw new FormulaError("Division par zéro dans la formule.");
        v = v / rhs;
      } else v = v * rhs;
    }
    return v;
  }
  function parseUnary(): number {
    if (peek() && peek().type === "op" && (peek().value === "+" || peek().value === "-")) {
      const op = next().value;
      const v = parseUnary();
      return op === "-" ? -v : v;
    }
    return parsePrimary();
  }
  function parsePrimary(): number {
    const t = peek();
    if (!t) throw new FormulaError("Formule incomplète.");
    if (t.type === "num") {
      next();
      const n = Number(t.value);
      if (!Number.isFinite(n)) throw new FormulaError(`Nombre invalide : « ${t.value} ».`);
      return n;
    }
    if (t.type === "paren" && t.value === "(") {
      next();
      const v = parseExpr();
      if (!peek() || peek().value !== ")") throw new FormulaError("Parenthèse fermante manquante.");
      next();
      return v;
    }
    if (t.type === "id") {
      next();
      // Appel de fonction ?
      if (peek() && peek().type === "paren" && peek().value === "(") {
        const fn = FUNCS[t.value];
        if (!fn) throw new FormulaError(`Fonction inconnue : « ${t.value} ». Fonctions autorisées : ${Object.keys(FUNCS).join(", ")}.`);
        next(); // (
        const args: number[] = [];
        if (peek() && peek().value !== ")") {
          args.push(parseExpr());
          while (peek() && peek().type === "comma") { next(); args.push(parseExpr()); }
        }
        if (!peek() || peek().value !== ")") throw new FormulaError(`Parenthèse fermante manquante après « ${t.value}( ».`);
        next(); // )
        return fn(args);
      }
      // Variable.
      if (!(t.value in ctx)) {
        throw new FormulaError(`Variable inconnue : « ${t.value} ». Variables disponibles : ${Object.keys(ctx).join(", ")}.`);
      }
      return ctx[t.value];
    }
    throw new FormulaError(`Élément inattendu dans la formule : « ${t.value} ».`);
  }

  const result = parseExpr();
  if (pos !== toks.length) throw new FormulaError(`Fin de formule inattendue près de « ${peek()?.value ?? ""} ».`);
  if (!Number.isFinite(result)) throw new FormulaError("Le résultat de la formule n'est pas un nombre valide.");
  return result;
}

// ── Éléments du bulletin dont la formule est modifiable par le RH ────────────
// L'IRPP (barème progressif) et la Taxe communale/RAV (par tranches) NE sont
// PAS des formules d'une ligne : ils restent pilotés par leurs paramètres dans
// « Paramètres ». On n'expose donc que les éléments réellement « à formule ».
export interface FormulaDef {
  code: string;
  label: string;
  description: string;
  defaultExpression: string;
  variables: string[]; // liste blanche pour cet élément (aide à la saisie)
}

export const FORMULA_DEFS: FormulaDef[] = [
  {
    code: "prime_anciennete",
    label: "Prime d'ancienneté",
    description: "Montant de la prime d'ancienneté, lorsqu'elle s'applique (le déclenchement — années ≥ seuil — reste géré par la fiche paie).",
    defaultExpression: "round(base * taux_anciennete)",
    variables: ["base", "complements", "taux_anciennete"],
  },
  {
    code: "salaire_brut",
    label: "Salaire brut",
    description: "Composition du brut mensuel à partir du salaire de base, des compléments, de la prime d'ancienneté et de la retenue d'absence.",
    defaultExpression: "max(base + complements + prime_anciennete - retenue_absence, 0)",
    variables: ["base", "complements", "prime_anciennete", "retenue_absence"],
  },
  {
    code: "pvid_salarie",
    label: "CNPS – PVID (salarié)",
    description: "Cotisation vieillesse/invalidité/décès, part salariale, sur l'assiette CNPS plafonnée.",
    defaultExpression: "round(assiette_cnps * taux_pvid_sal)",
    variables: ["assiette_cnps", "taux_pvid_sal"],
  },
  {
    code: "pvid_patronal",
    label: "CNPS – PVID (patronal)",
    description: "Cotisation vieillesse/invalidité/décès, part patronale, sur l'assiette CNPS plafonnée.",
    defaultExpression: "round(assiette_cnps * taux_pvid_pat)",
    variables: ["assiette_cnps", "taux_pvid_pat"],
  },
  {
    code: "prestations_familiales",
    label: "CNPS – Prestations familiales",
    description: "Cotisation patronale prestations familiales sur l'assiette CNPS plafonnée.",
    defaultExpression: "round(assiette_cnps * taux_pf)",
    variables: ["assiette_cnps", "taux_pf"],
  },
  {
    code: "accidents_travail",
    label: "CNPS – Accidents du travail",
    description: "Cotisation patronale accidents du travail sur l'assiette CNPS plafonnée.",
    defaultExpression: "round(assiette_cnps * taux_at)",
    variables: ["assiette_cnps", "taux_at"],
  },
  {
    code: "cfc_salarie",
    label: "CFC (salarié)",
    description: "Crédit Foncier, part salariale, sur l'assiette fiscale.",
    defaultExpression: "round(assiette_fiscale * taux_cfc_sal)",
    variables: ["assiette_fiscale", "taux_cfc_sal"],
  },
  {
    code: "cfc_patronal",
    label: "CFC (patronal)",
    description: "Crédit Foncier, part patronale, sur l'assiette fiscale.",
    defaultExpression: "round(assiette_fiscale * taux_cfc_pat)",
    variables: ["assiette_fiscale", "taux_cfc_pat"],
  },
  {
    code: "fne",
    label: "FNE",
    description: "Fonds National de l'Emploi, part patronale, sur l'assiette fiscale.",
    defaultExpression: "round(assiette_fiscale * taux_fne)",
    variables: ["assiette_fiscale", "taux_fne"],
  },
];

export const FORMULA_CODES = FORMULA_DEFS.map((d) => d.code);
export const FORMULA_BY_CODE: Record<string, FormulaDef> = Object.fromEntries(FORMULA_DEFS.map((d) => [d.code, d]));

// Surcharge de formules transmise au moteur : code → expression.
export type FormulaOverlay = Record<string, string>;

// Évalue un élément : si une formule personnalisée existe pour ce code, on
// l'applique ; sinon on renvoie la valeur par défaut (moteur codé en dur).
// En cas d'erreur d'évaluation on RETOMBE sur la valeur par défaut : jamais de
// paie cassée par une formule invalide (la validation à l'enregistrement empêche
// normalement d'en arriver là).
export function evalLeaf(code: string, overlay: FormulaOverlay | undefined, fallback: number, ctx: Ctx): number {
  const expr = overlay?.[code];
  if (!expr) return fallback;
  try {
    const v = evaluateExpression(expr, ctx);
    return Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
