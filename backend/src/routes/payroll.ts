import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { computePayslip, type Payslip, type PayrollRates, type FormulaOverlay } from "../lib/payrollEngine.js";
import { evaluateExpression, FormulaError, FORMULA_BY_CODE, FORMULA_CODES } from "../lib/payrollFormula.js";
import type { PayrollEmployeeProfile, PayrollMonthlyLine } from "@prisma/client";
import { syncRunPrimes } from "../lib/payrollPrimes.js";
import { buildPayslipEmail } from "../lib/documentEmail.js";
import { absenceAutoDeductionEnabled, setAbsenceAutoDeduction, computeAbsenceDeduction } from "../lib/absencePayDeduction.js";
import { SALARY_ELEMENT_CATEGORY_LABELS, FISCAL_STATUS_LABELS, CNPS_STATUS_LABELS } from "../lib/salaryElements.js";
import { sendMail, senderIdentity } from "../lib/mailer.js";
import { notifyRole, notifyUsers } from "../lib/notify.js";

// Circuit de validation de la paie (Temps 1) : le DG est prévenu à la soumission,
// le RH au retour/validation, et le DAF est notifié à la validation pour le suivi
// (décaissement + déclarations). Rôles destinataires.
const DG_ROLES = ["DIR_GENERAL", "ADMIN_GENERAL"] as const;
const DAF_ROLE = "RESP_FINANCE";
const RH_ROLE = "RESP_RH";

// Module « Paie » natif (D-007) — incrément 1 : barème légal camerounais
// PARAMÉTRABLE et VERSIONNÉ, et interrupteur d'internalisation (oui/non).
// Réimplémentation du moteur Excel (docs/paie/). Permissions : module `paie`.

const num = (v: unknown): number => (v == null ? 0 : Number(v));

// Charge les formules PERSONNALISÉES par le RH (custom = true) sous forme d'un
// overlay code → expression, transmis au moteur. Les formules non personnalisées
// n'y figurent pas : le moteur garde alors son calcul par défaut codé en dur.
async function loadFormulaOverlay(): Promise<FormulaOverlay | undefined> {
  const rows = await prisma.payrollFormula.findMany({ where: { custom: true } });
  if (rows.length === 0) return undefined;
  return Object.fromEntries(rows.map((r) => [r.code, r.expression]));
}

function rateSetView(r: Record<string, unknown> & { id: string; effectiveFrom: Date; label: string | null; active: boolean }) {
  return {
    id: r.id,
    effective_from: (r.effectiveFrom as Date).toISOString().slice(0, 10),
    label: r.label,
    active: r.active,
    change_reason: (r.changeReason as string | null) ?? null,
    created_at: r.createdAt instanceof Date ? (r.createdAt as Date).toISOString() : null,
    created_by: (r.createdBy as string | null) ?? null,
    cnps: { vid_sal_pct: num(r.vidSalPct), vid_pat_pct: num(r.vidPatPct), pf_pct: num(r.pfPct), at_pct: num(r.atPct), ceiling: num(r.cnpsCeiling) },
    fiscal: { abat_pct: num(r.abatPct), abat_fixe: num(r.abatFixe), cac_pct: num(r.cacPct), cfc_sal_pct: num(r.cfcSalPct), cfc_pat_pct: num(r.cfcPatPct), fne_pct: num(r.fnePct) },
    misc: { coef_assiette: num(r.coefAssiette), heures_mois: num(r.heuresMois), anc_def_pct: num(r.ancDefPct) },
    irpp: { t1_ceiling: num(r.irppT1Ceiling), t1_pct: num(r.irppT1Pct), t2_ceiling: num(r.irppT2Ceiling), t2_pct: num(r.irppT2Pct), t3_ceiling: num(r.irppT3Ceiling), t3_pct: num(r.irppT3Pct), t4_pct: num(r.irppT4Pct) },
    tc_rav: { seuil1: num(r.tcRavSeuil1), tc1: num(r.tc1), rav1: num(r.rav1), seuil2: num(r.tcRavSeuil2), tc2: num(r.tc2), rav2: num(r.rav2), tc3: num(r.tc3), rav3: num(r.rav3) },
    // Barème des avantages en nature (CGI art. 33), en fraction du brut taxable.
    avantages_nature: {
      logement: num(r.anLogementPct), electricite: num(r.anElectricitePct), eau: num(r.anEauPct),
      domestique: num(r.anDomestiquePct), vehicule: num(r.anVehiculePct), nourriture: num(r.anNourriturePct),
    },
  };
}

const pct = z.number().min(0).max(1);
const money = z.number().min(0);
const rateSetSchema = z.object({
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().max(120).optional(),
  change_reason: z.string().max(2000).optional(),
  cnps: z.object({ vid_sal_pct: pct, vid_pat_pct: pct, pf_pct: pct, at_pct: pct, ceiling: money }),
  fiscal: z.object({ abat_pct: pct, abat_fixe: money, cac_pct: pct, cfc_sal_pct: pct, cfc_pat_pct: pct, fne_pct: pct }),
  misc: z.object({ coef_assiette: pct, heures_mois: z.number().positive(), anc_def_pct: pct }),
  irpp: z.object({ t1_ceiling: money, t1_pct: pct, t2_ceiling: money, t2_pct: pct, t3_ceiling: money, t3_pct: pct, t4_pct: pct }),
  tc_rav: z.object({ seuil1: money, tc1: money, rav1: money, seuil2: money, tc2: money, rav2: money, tc3: money, rav3: money }),
  // Barème avantages en nature (optionnel : défauts légaux si absent).
  avantages_nature: z.object({ logement: pct, electricite: pct, eau: pct, domestique: pct, vehicule: pct, nourriture: pct }).optional(),
});

// Contexte d'exemple pour tester/valider une formule. On restreint aux
// variables AUTORISÉES pour l'élément (liste blanche du def) : une formule qui
// référence une variable hors de cette liste est rejetée à l'enregistrement.
const FORMULA_SAMPLE: Record<string, number> = {
  base: 400000, complements: 50000, taux_anciennete: 0.05, prime_anciennete: 20000, retenue_absence: 0,
  assiette_cnps: 600000, assiette_fiscale: 470000,
  taux_pvid_sal: 0.042, taux_pvid_pat: 0.042, taux_pf: 0.07, taux_at: 0.03,
  taux_cfc_sal: 0.01, taux_cfc_pat: 0.015, taux_fne: 0.01,
};
function sampleContextFor(code: string): Record<string, number> {
  const def = FORMULA_BY_CODE[code];
  if (!def) return {};
  return Object.fromEntries(def.variables.map((v) => [v, FORMULA_SAMPLE[v] ?? 0]));
}
function formulaView(row: { code: string; label: string; expression: string; custom: boolean; changeReason: string | null; updatedAt: Date; updatedBy: string | null }) {
  const def = FORMULA_BY_CODE[row.code];
  return {
    code: row.code,
    label: row.label,
    description: def?.description ?? "",
    variables: def?.variables ?? [],
    expression: row.expression,
    default_expression: def?.defaultExpression ?? row.expression,
    custom: row.custom,
    change_reason: row.changeReason,
    updated_at: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
    updated_by: row.updatedBy,
  };
}
const formulaUpdateSchema = z.object({
  // custom = true : appliquer l'expression fournie. custom = false : réinitialiser
  // au calcul par défaut du moteur.
  custom: z.boolean(),
  expression: z.string().max(500).optional(),
  change_reason: z.string().min(3).max(2000),
});

// Éléments variables du mois pour un salarié (grille mensuelle).
const monthlyLineSchema = z.object({
  // Salaire de la PÉRIODE (facultatif) : corriger le salaire de base / brut
  // contractuel de CE mois uniquement, sans toucher aux autres périodes ni à la
  // fiche. N'est écrit que si fourni.
  base_salary: money.optional(),
  gross_contractual: money.optional(),
  // Les primes sont désormais gérées par le module « Primes du mois » (source
  // unique) : ce champ reste accepté (compatibilité) mais l'interface ne l'envoie
  // plus — il n'est écrit que s'il est fourni.
  primes: money.optional(), heures_sup: money, retenue_absence: money,
  retard: money, avance: money, pret: money, sanction: money, autres: money,
  // Lignes libres ajoutées par le RH (aucune codée en dur) : gains imposables
  // ou retenues nettes, avec un libellé et un montant.
  extra_lines: z.array(z.object({
    label: z.string().min(1).max(80), kind: z.enum(["gain", "retenue"]), amount: money, element_code: z.string().max(60).optional(),
    // Avantage en nature évalué au barème (Niveau 2, étape B+) : type de barème
    // (logement, véhicule…) + quantité (véhicules/domestiques). Le montant est
    // alors calculé par le moteur (% du brut taxable), non saisi à la main.
    bareme_type: z.enum(["logement", "electricite", "eau", "domestique", "vehicule", "nourriture"]).optional(),
    quantity: z.number().int().min(1).max(20).optional(),
  })).max(30).optional(),
  note: z.string().max(500).nullable().optional(),
});

// `element_code` (facultatif) : rattache une ligne libre à une rubrique du
// catalogue (Niveau 2). Quand la rubrique est activée, son traitement fiscal/CNPS
// s'applique automatiquement à la place du choix binaire gain/retenue.
type BaremeType = "logement" | "electricite" | "eau" | "domestique" | "vehicule" | "nourriture";
const BAREME_TYPES: BaremeType[] = ["logement", "electricite", "eau", "domestique", "vehicule", "nourriture"];
type ExtraLine = { label: string; kind: "gain" | "retenue"; amount: number; element_code?: string; bareme_type?: BaremeType; quantity?: number };
function parseExtraLines(v: unknown): ExtraLine[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      if (typeof o.label === "string" && (o.kind === "gain" || o.kind === "retenue") && typeof o.amount === "number") {
        const baremeType = typeof o.bareme_type === "string" && (BAREME_TYPES as string[]).includes(o.bareme_type) ? (o.bareme_type as BaremeType) : undefined;
        return [{
          label: o.label, kind: o.kind, amount: Math.max(o.amount, 0),
          ...(typeof o.element_code === "string" ? { element_code: o.element_code } : {}),
          ...(baremeType ? { bareme_type: baremeType } : {}),
          ...(typeof o.quantity === "number" && o.quantity >= 1 ? { quantity: Math.floor(o.quantity) } : {}),
        }];
      }
    }
    return [];
  });
}

// Rubriques du catalogue ACTIVÉES (in_force) : code → traitement légal. Sert à
// ventiler les lignes typées d'un bulletin (base fiscale / base CNPS / brut).
type RubriqueInfo = { category: string; fiscal: string; cnps: string };
async function activeRubriqueMap(): Promise<Map<string, RubriqueInfo>> {
  const rows = await prisma.salaryElement.findMany({ where: { inForce: true, active: true }, select: { code: true, category: true, fiscalStatus: true, cnpsStatus: true } });
  return new Map(rows.map((r) => [r.code, { category: r.category, fiscal: r.fiscalStatus, cnps: r.cnpsStatus }]));
}

// Ventile les lignes libres d'un bulletin : celles rattachées à une rubrique
// ACTIVE suivent son traitement (brut / fiscal / CNPS) ; les autres restent des
// lignes libres classiques (gain imposable+cotisable ou retenue nette).
function splitExtraLines(extras: ExtraLine[], map: Map<string, RubriqueInfo> | undefined, anBareme?: PayrollRates["avantagesNature"]) {
  let rubriqueBrut = 0, rubriqueTaxable = 0, rubriqueCotisable = 0;
  // Avantages en nature évalués au barème : on cumule des FRACTIONS du brut
  // taxable (pct × quantité), le moteur les multipliera par son assiette.
  let anTaxablePct = 0, anCotisablePct = 0;
  const untyped: ExtraLine[] = [];
  for (const e of extras) {
    const info = e.element_code && map ? map.get(e.element_code) : undefined;
    if (!info) { untyped.push(e); continue; }
    const isAvantageNature = info.category === "avantage_nature";
    // Avantage en nature « au barème » : montant non saisi mais évalué (% du brut).
    if (isAvantageNature && e.bareme_type && anBareme) {
      const frac = (anBareme[e.bareme_type] ?? 0) * (e.quantity && e.quantity >= 1 ? e.quantity : 1);
      if (info.fiscal === "taxable" || info.fiscal === "partiel") anTaxablePct += frac;
      if (info.cnps === "cotisable" || info.cnps === "partiel") anCotisablePct += frac;
      continue; // pas de montant espèces ni de part fixe : tout passe par le barème
    }
    if (!isAvantageNature) rubriqueBrut += e.amount; // avantage en nature = non payé en espèces
    if (info.fiscal === "taxable" || info.fiscal === "partiel") rubriqueTaxable += e.amount;
    if (info.cnps === "cotisable" || info.cnps === "partiel") rubriqueCotisable += e.amount;
  }
  const extraGains = untyped.filter((e) => e.kind === "gain").reduce((s, e) => s + e.amount, 0);
  const extraRetenues = untyped.filter((e) => e.kind === "retenue").reduce((s, e) => s + e.amount, 0);
  return { rubriqueBrut, rubriqueTaxable, rubriqueCotisable, extraGains, extraRetenues, avantageNatureTaxablePct: anTaxablePct, avantageNatureCotisablePct: anCotisablePct };
}

export default async function payrollRoutes(fastify: FastifyInstance) {
  // Interrupteur d'internalisation de la paie (D-007). « false » = export externe.
  fastify.get(
    "/api/v1/payroll/config",
    { preHandler: requirePermission("paie", "consultation") },
    async (_request, reply) => {
      const s = await prisma.setting.findUnique({ where: { key: "payroll_internal_enabled" } });
      return reply.send({ internal_enabled: String(s?.value) === "true" });
    },
  );

  fastify.put(
    "/api/v1/payroll/config",
    { preHandler: requirePermission("paie", "administration") },
    async (request, reply) => {
      const parsed = z.object({ internal_enabled: z.boolean() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides." });
      const value = parsed.data.internal_enabled ? "true" : "false";
      await prisma.setting.upsert({ where: { key: "payroll_internal_enabled" }, update: { value }, create: { key: "payroll_internal_enabled", value } });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "payroll_config", entityId: "payroll_internal_enabled", newValues: { internal_enabled: parsed.data.internal_enabled }, ipAddress: request.ip });
      return reply.send({ internal_enabled: parsed.data.internal_enabled });
    },
  );

  // Barèmes versionnés — liste (plus récent d'abord).
  fastify.get(
    "/api/v1/payroll/rate-sets",
    { preHandler: requirePermission("paie", "consultation") },
    async (_request, reply) => {
      const rows = await prisma.payrollRateSet.findMany({ orderBy: { effectiveFrom: "desc" } });
      return reply.send(rows.map(rateSetView));
    },
  );

  // Barème applicable à une date (le plus récent actif dont l'effet précède la date).
  fastify.get(
    "/api/v1/payroll/rate-set",
    { preHandler: requirePermission("paie", "consultation") },
    async (request, reply) => {
      const query = request.query as { date?: string };
      const onDate = query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? new Date(`${query.date}T00:00:00.000Z`) : new Date();
      const row = await prisma.payrollRateSet.findFirst({ where: { active: true, effectiveFrom: { lte: onDate } }, orderBy: { effectiveFrom: "desc" } });
      if (!row) return reply.code(404).send({ code: "not_found", message: "Aucun barème de paie en vigueur." });
      return reply.send(rateSetView(row));
    },
  );

  // Nouvelle version du barème (les anciennes sont conservées).
  fastify.post(
    "/api/v1/payroll/rate-sets",
    { preHandler: requirePermission("paie", "administration") },
    async (request, reply) => {
      const parsed = rateSetSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      const b = parsed.data;
      const created = await prisma.payrollRateSet.create({
        data: {
          effectiveFrom: new Date(`${b.effective_from}T00:00:00.000Z`),
          label: b.label,
          changeReason: b.change_reason,
          vidSalPct: b.cnps.vid_sal_pct, vidPatPct: b.cnps.vid_pat_pct, pfPct: b.cnps.pf_pct, atPct: b.cnps.at_pct, cnpsCeiling: b.cnps.ceiling,
          abatPct: b.fiscal.abat_pct, abatFixe: b.fiscal.abat_fixe, cacPct: b.fiscal.cac_pct, cfcSalPct: b.fiscal.cfc_sal_pct, cfcPatPct: b.fiscal.cfc_pat_pct, fnePct: b.fiscal.fne_pct,
          coefAssiette: b.misc.coef_assiette, heuresMois: b.misc.heures_mois, ancDefPct: b.misc.anc_def_pct,
          irppT1Ceiling: b.irpp.t1_ceiling, irppT1Pct: b.irpp.t1_pct, irppT2Ceiling: b.irpp.t2_ceiling, irppT2Pct: b.irpp.t2_pct, irppT3Ceiling: b.irpp.t3_ceiling, irppT3Pct: b.irpp.t3_pct, irppT4Pct: b.irpp.t4_pct,
          tcRavSeuil1: b.tc_rav.seuil1, tc1: b.tc_rav.tc1, rav1: b.tc_rav.rav1, tcRavSeuil2: b.tc_rav.seuil2, tc2: b.tc_rav.tc2, rav2: b.tc_rav.rav2, tc3: b.tc_rav.tc3, rav3: b.tc_rav.rav3,
          ...(b.avantages_nature
            ? {
                anLogementPct: b.avantages_nature.logement, anElectricitePct: b.avantages_nature.electricite, anEauPct: b.avantages_nature.eau,
                anDomestiquePct: b.avantages_nature.domestique, anVehiculePct: b.avantages_nature.vehicule, anNourriturePct: b.avantages_nature.nourriture,
              }
            : {}),
          createdBy: request.user!.id,
        },
      });
      await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "payroll_rate_set", entityId: created.id, newValues: { effective_from: b.effective_from, label: b.label ?? null, change_reason: b.change_reason ?? null }, ipAddress: request.ip });
      return reply.code(201).send(rateSetView(created));
    },
  );

  // ----- Catalogue des éléments de salaire (traitement fiscal / CNPS) ---------
  // Guide de référence (CGI, Ordonnance CNPS…) : quel élément est taxable/exonéré
  // et cotisable/non. Consultable par le RH ; statuts modifiables par un
  // administrateur (tracé). Sert de base au calcul par rubriques (à venir).
  fastify.get("/api/v1/payroll/salary-elements", { preHandler: requirePermission("paie", "consultation") }, async (request, reply) => {
    const q = request.query as { all?: string };
    const rows = await prisma.salaryElement.findMany({
      where: q.all === "1" ? {} : { active: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    });
    return reply.send({
      elements: rows.map((r) => ({
        code: r.code, label: r.label, category: r.category,
        category_label: SALARY_ELEMENT_CATEGORY_LABELS[r.category] ?? r.category,
        fiscal_status: r.fiscalStatus, fiscal_label: FISCAL_STATUS_LABELS[r.fiscalStatus as keyof typeof FISCAL_STATUS_LABELS] ?? r.fiscalStatus,
        cnps_status: r.cnpsStatus, cnps_label: CNPS_STATUS_LABELS[r.cnpsStatus as keyof typeof CNPS_STATUS_LABELS] ?? r.cnpsStatus,
        legal_ref: r.legalRef, active: r.active,
        in_force: r.inForce, effective_from: r.effectiveFrom ? r.effectiveFrom.toISOString().slice(0, 10) : null,
      })),
      fiscal_statuses: Object.entries(FISCAL_STATUS_LABELS).map(([value, label]) => ({ value, label })),
      cnps_statuses: Object.entries(CNPS_STATUS_LABELS).map(([value, label]) => ({ value, label })),
    });
  });

  fastify.patch("/api/v1/payroll/salary-elements/:code", { preHandler: requirePermission("paie", "administration") }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const parsed = z
      .object({
        label: z.string().min(1).optional(),
        fiscal_status: z.enum(["taxable", "non_taxable", "partiel"]).optional(),
        cnps_status: z.enum(["cotisable", "non_cotisable", "partiel"]).optional(),
        legal_ref: z.string().max(500).nullable().optional(),
        active: z.boolean().optional(),
        // Activation (étape A) : mettre « en vigueur » (avec date d'effet) ou « en attente ».
        in_force: z.boolean().optional(),
        effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const existing = await prisma.salaryElement.findUnique({ where: { code } });
    if (!existing) return reply.code(404).send({ code: "not_found", message: "Élément de salaire introuvable." });
    const d = parsed.data;
    const updated = await prisma.salaryElement.update({
      where: { code },
      data: {
        ...(d.label !== undefined ? { label: d.label } : {}),
        ...(d.fiscal_status !== undefined ? { fiscalStatus: d.fiscal_status } : {}),
        ...(d.cnps_status !== undefined ? { cnpsStatus: d.cnps_status } : {}),
        ...(d.legal_ref !== undefined ? { legalRef: d.legal_ref } : {}),
        ...(d.active !== undefined ? { active: d.active } : {}),
        ...(d.in_force !== undefined ? { inForce: d.in_force } : {}),
        ...(d.effective_from !== undefined ? { effectiveFrom: d.effective_from ? new Date(`${d.effective_from}T00:00:00.000Z`) : null } : {}),
        updatedBy: request.user!.id,
      },
    });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "salary_element", entityId: code, oldValues: existing as never, newValues: updated as never, ipAddress: request.ip });
    return reply.send({ code: updated.code, fiscal_status: updated.fiscalStatus, cnps_status: updated.cnpsStatus, active: updated.active, in_force: updated.inForce, effective_from: updated.effectiveFrom ? updated.effectiveFrom.toISOString().slice(0, 10) : null });
  });

  // ----- Formules de calcul modifiables par le RH (D-007) --------------------
  // Le RH peut personnaliser la formule de certains éléments du bulletin
  // (cotisations, brut, prime d'ancienneté), avec un MOTIF obligatoire. L'IRPP
  // et la Taxe communale/RAV restent pilotés par leurs paramètres (barèmes).

  // Liste des formules (celles réellement appliquées par le moteur).
  fastify.get(
    "/api/v1/payroll/formulas",
    { preHandler: requirePermission("paie", "consultation") },
    async (_request, reply) => {
      const rows = await prisma.payrollFormula.findMany();
      // On ordonne selon l'ordre métier des éléments (FORMULA_CODES).
      const byCode = new Map(rows.map((r) => [r.code, r]));
      const ordered = FORMULA_CODES.map((c) => byCode.get(c)).filter((r): r is NonNullable<typeof r> => Boolean(r));
      return reply.send(ordered.map(formulaView));
    },
  );

  // Tester une expression AVANT de l'enregistrer : renvoie le résultat par défaut
  // et le résultat proposé sur un exemple, ou une erreur explicite.
  fastify.post(
    "/api/v1/payroll/formulas/:code/test",
    { preHandler: requirePermission("paie", "consultation") },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const def = FORMULA_BY_CODE[code];
      if (!def) return reply.code(404).send({ code: "not_found", message: "Élément de formule inconnu." });
      const parsed = z.object({ expression: z.string().min(1).max(500) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Expression manquante." });
      const ctx = sampleContextFor(code);
      const defaultResult = evaluateExpression(def.defaultExpression, ctx);
      try {
        const result = evaluateExpression(parsed.data.expression, ctx);
        return reply.send({ ok: true, sample: ctx, default_result: defaultResult, result });
      } catch (e) {
        const message = e instanceof FormulaError ? e.message : "Formule invalide.";
        return reply.send({ ok: false, sample: ctx, default_result: defaultResult, error: message });
      }
    },
  );

  // Modifier (ou réinitialiser) une formule — MOTIF obligatoire, tracé à l'audit.
  fastify.put(
    "/api/v1/payroll/formulas/:code",
    { preHandler: requirePermission("paie", "administration") },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const def = FORMULA_BY_CODE[code];
      if (!def) return reply.code(404).send({ code: "not_found", message: "Élément de formule inconnu." });
      const parsed = formulaUpdateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Motif obligatoire (au moins 3 caractères) et champs valides requis.", details: parsed.error.issues });
      const b = parsed.data;
      const existing = await prisma.payrollFormula.findUnique({ where: { code } });
      if (!existing) return reply.code(404).send({ code: "not_found", message: "Formule introuvable." });

      let expression: string;
      let custom: boolean;
      if (b.custom) {
        // Personnalisation : l'expression est requise et doit être VALIDE sur la
        // liste blanche de l'élément (variables autorisées + fonctions min/max/…).
        if (!b.expression || !b.expression.trim()) return reply.code(400).send({ code: "validation_error", message: "Expression requise pour personnaliser la formule." });
        try {
          evaluateExpression(b.expression, sampleContextFor(code));
        } catch (e) {
          const message = e instanceof FormulaError ? e.message : "Formule invalide.";
          return reply.code(400).send({ code: "invalid_formula", message });
        }
        expression = b.expression.trim();
        custom = true;
      } else {
        // Réinitialisation au calcul par défaut du moteur.
        expression = def.defaultExpression;
        custom = false;
      }

      const updated = await prisma.payrollFormula.update({
        where: { code },
        data: { expression, custom, changeReason: b.change_reason, updatedBy: request.user!.id },
      });
      await writeAuditLog({
        userId: request.user!.id, action: "update", entityType: "payroll_formula", entityId: code,
        oldValues: { expression: existing.expression, custom: existing.custom },
        newValues: { expression, custom, change_reason: b.change_reason },
        ipAddress: request.ip,
      });
      return reply.send(formulaView(updated));
    },
  );

  // ----- Fiche paie de l'employé (incrément 2) -------------------------------

  // Consultation d'une fiche paie (donnée sensible → accès journalisé).
  fastify.get(
    "/api/v1/payroll/employees/:employeeId/profile",
    { preHandler: requirePermission("paie", "consultation") },
    async (request, reply) => {
      const { employeeId } = request.params as { employeeId: string };
      const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null }, select: { id: true, firstName: true, lastName: true } });
      if (!employee) return reply.code(404).send({ code: "not_found", message: "Employé introuvable." });
      const profile = await prisma.payrollEmployeeProfile.findUnique({ where: { employeeId } });
      await writeAuditLog({ userId: request.user!.id, action: "view_sensitive", entityType: "payroll_employee_profile", entityId: employeeId, ipAddress: request.ip });
      return reply.send({ employee: { id: employee.id, name: `${employee.firstName} ${employee.lastName}` }, profile: profile ? profileView(profile) : null });
    },
  );

  // Création / mise à jour de la fiche paie — journalisée.
  fastify.put(
    "/api/v1/payroll/employees/:employeeId/profile",
    { preHandler: requirePermission("paie", "saisie") },
    async (request, reply) => {
      const { employeeId } = request.params as { employeeId: string };
      const parsed = profileSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
      if (!employee) return reply.code(404).send({ code: "not_found", message: "Employé introuvable." });
      const b = parsed.data;
      const data = {
        matricule: b.matricule ?? null,
        email: b.email ? b.email : null,
        cnpsNumber: b.cnps_number ?? null,
        niu: b.niu ?? null,
        category: b.category ?? null,
        paymentMode: b.payment_mode ?? null,
        accountNumber: b.account_number ?? null,
        grossContractual: b.gross_contractual,
        basePct: b.base_pct,
        fiscalBase: b.fiscal_base ?? null,
        fiscalParts: b.fiscal_parts,
        applyFiscalParts: b.apply_fiscal_parts,
        seniorityYears: b.seniority_years,
        seniorityRate: b.seniority_rate ?? null,
        seniorityThreshold: b.seniority_threshold ?? null,
        applySeniority: b.apply_seniority,
      };
      const saved = await prisma.payrollEmployeeProfile.upsert({
        where: { employeeId },
        update: { ...data, updatedBy: request.user!.id },
        create: { employeeId, ...data, createdBy: request.user!.id },
      });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "payroll_employee_profile", entityId: employeeId, newValues: { gross_contractual: b.gross_contractual, base_pct: b.base_pct, ...(b.modification_reason ? { modification_reason: b.modification_reason } : {}) }, ipAddress: request.ip });
      return reply.send(profileView(saved));
    },
  );

  // ----- Calcul du bulletin (incrément 3) : brut → net -----------------------
  fastify.get(
    "/api/v1/payroll/employees/:employeeId/payslip",
    { preHandler: requirePermission("paie", "consultation") },
    async (request, reply) => {
      const { employeeId } = request.params as { employeeId: string };
      const q = request.query as { period?: string; retenue_absence?: string; avance?: string; pret?: string; retard?: string; autres?: string };
      const period = normalizePeriod(q.period);
      // Retenue d'absence saisie par le RH (0 par défaut) — jamais issue des présences.
      const manualRetenue = q.retenue_absence != null ? Math.max(Number(q.retenue_absence) || 0, 0) : 0;
      // Retenues internes du mois saisies par le RH (prêts, avances, retards, autres).
      const pos = (v?: string) => Math.max(Number(v) || 0, 0);
      const internal = { avance: pos(q.avance), pret: pos(q.pret), retard: pos(q.retard), autres: pos(q.autres) };
      const resolved = await resolvePayslip(employeeId, period, manualRetenue, internal);
      if ("error" in resolved) return reply.code(resolved.status).send(resolved.error);
      await writeAuditLog({ userId: request.user!.id, action: "view_sensitive", entityType: "payslip", entityId: `${employeeId}:${period}`, ipAddress: request.ip });
      return reply.send({
        employee: { id: resolved.employee.id, name: resolved.employeeName },
        period,
        rate_set_effective_from: resolved.rateEffectiveFrom,
        rates: resolved.rates,
        payslip: resolved.payslip,
        // Témoin indicatif du cahier de présence (n'est pas appliqué au net).
        attendance_witness: resolved.attendanceWitness,
      });
    },
  );

  // ----- Retenues du mois : RELIÉES À LA GRILLE MENSUELLE --------------------
  // Source UNIQUE = payroll_monthly_lines. Les retenues saisies au bulletin
  // unitaire et celles de la grille mensuelle sont le même enregistrement : pas
  // de double saisie ni de divergence. La saisie n'est possible que tant que le
  // mois est en « brouillon » (avant soumission au Directeur général).
  fastify.get(
    "/api/v1/payroll/employees/:employeeId/deductions",
    { preHandler: requirePermission("paie", "consultation") },
    async (request, reply) => {
      const { employeeId } = request.params as { employeeId: string };
      const period = normalizePeriod((request.query as { period?: string }).period);
      const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period }, select: { id: true, status: true } });
      const line = run
        ? await prisma.payrollMonthlyLine.findUnique({ where: { runId_employeeId: { runId: run.id, employeeId } } })
        : null;
      // Mode « retenue automatique des absences » : on calcule le montant suggéré
      // (jours d'absences non payées × salaire journalier) pour le proposer/pré-
      // remplir. Le RH reste libre de le corriger ou de saisir à la main.
      const autoEnabled = await absenceAutoDeductionEnabled();
      let suggested = 0;
      let suggestedDays = 0;
      if (autoEnabled) {
        const profile = await prisma.payrollEmployeeProfile.findUnique({ where: { employeeId } });
        const confidential = await prisma.employeeConfidential.findUnique({ where: { employeeId }, select: { baseSalary: true } });
        if (profile) {
          const { base } = resolveBaseGross(profile, confidential?.baseSalary != null ? num(confidential.baseSalary) : null);
          const d = await computeAbsenceDeduction(employeeId, period, base);
          suggested = d.amount;
          suggestedDays = d.days;
        }
      }
      return reply.send({
        period,
        primes: line ? num(line.primes) : 0,
        heures_sup: line ? num(line.heuresSup) : 0,
        retenue_absence: line ? num(line.retenueAbsence) : 0,
        avance: line ? num(line.avance) : 0,
        pret: line ? num(line.pret) : 0,
        retard: line ? num(line.retard) : 0,
        autres: line ? num(line.autres) : 0,
        sanction: line ? num(line.sanction) : 0, // saisie uniquement dans la grille
        extra_lines: line ? parseExtraLines(line.extraLines) : [], // lignes libres (grille)
        status: run?.status ?? null, // null | brouillon | soumis_dg | valide
        locked: run != null && run.status !== "brouillon",
        saved: line != null,
        // Retenue automatique des absences (temps 2) : interrupteur + suggestion.
        auto_absence_enabled: autoEnabled,
        suggested_retenue_absence: suggested,
        unpaid_absence_days: suggestedDays,
      });
    },
  );

  // Interrupteur RH « retenue automatique des absences non payées » (temps 2).
  // OFF (défaut) = saisie manuelle par le RH ; ON = montant calculé et proposé.
  fastify.get("/api/v1/payroll/absence-auto-deduction", { preHandler: requirePermission("paie", "consultation") }, async (_request, reply) => {
    return reply.send({ enabled: await absenceAutoDeductionEnabled() });
  });

  fastify.put("/api/v1/payroll/absence-auto-deduction", { preHandler: requirePermission("paie", "administration") }, async (request, reply) => {
    const parsed = z.object({ enabled: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Valeur invalide.", details: parsed.error.issues });
    const enabled = await setAbsenceAutoDeduction(parsed.data.enabled, request.user!.id);
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "setting", entityId: "absence_auto_deduction", newValues: { enabled } as never, ipAddress: request.ip });
    return reply.send({ enabled });
  });

  // Aperçu de la retenue d'absence calculée pour un salarié et un mois (jours
  // d'absences non payées × salaire journalier), quel que soit le mode.
  fastify.get("/api/v1/payroll/employees/:employeeId/absence-deduction", { preHandler: requirePermission("paie", "consultation") }, async (request, reply) => {
    const { employeeId } = request.params as { employeeId: string };
    const period = normalizePeriod((request.query as { period?: string }).period);
    const profile = await prisma.payrollEmployeeProfile.findUnique({ where: { employeeId } });
    if (!profile) return reply.code(409).send({ code: "no_profile", message: "Aucune fiche paie pour cet employé." });
    const confidential = await prisma.employeeConfidential.findUnique({ where: { employeeId }, select: { baseSalary: true } });
    const { base } = resolveBaseGross(profile, confidential?.baseSalary != null ? num(confidential.baseSalary) : null);
    const d = await computeAbsenceDeduction(employeeId, period, base);
    return reply.send({ period, auto_enabled: await absenceAutoDeductionEnabled(), days: d.days, daily: d.daily, amount: d.amount });
  });

  fastify.put(
    "/api/v1/payroll/employees/:employeeId/deductions",
    { preHandler: requirePermission("paie", "saisie") },
    async (request, reply) => {
      const { employeeId } = request.params as { employeeId: string };
      const parsed = z
        .object({
          period: z.string(),
          // Primes gérées par le module « Primes du mois » : champ optionnel,
          // écrit seulement s'il est fourni (compatibilité ascendante).
          primes: money.optional(),
          heures_sup: money.default(0),
          retenue_absence: money.default(0),
          avance: money.default(0),
          pret: money.default(0),
          retard: money.default(0),
          autres: money.default(0),
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Montants invalides.", details: parsed.error.issues });
      const period = normalizePeriod(parsed.data.period);
      const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null }, select: { id: true } });
      if (!employee) return reply.code(404).send({ code: "not_found", message: "Employé introuvable." });

      // Le mois doit être en « brouillon » : soumis/validé = verrouillé (mêmes
      // messages que la grille mensuelle, pour un discours cohérent au RH).
      let run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period } });
      if (run && run.status === "valide") return reply.code(409).send({ code: "run_locked", message: "Mois validé par la Direction : il n'est plus modifiable. Rouvrez-le pour corriger." });
      if (run && run.status === "soumis_dg") return reply.code(409).send({ code: "run_submitted", message: "Mois soumis au Directeur général : en attente de validation, il n'est plus modifiable. Le DG doit le valider ou le retourner pour correction." });

      // Aucun mois préparé encore : on l'ouvre en brouillon et on crée une ligne
      // par salarié doté d'une fiche paie (comme « préparer le mois »). Ainsi la
      // grille mensuelle et le bulletin unitaire partent du même point.
      if (!run) {
        run = await prisma.payrollMonthlyRun.create({ data: { periodKey: period, preparedBy: request.user!.id } });
        await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "payroll_monthly_run", entityId: period, ipAddress: request.ip });
        const profiles = await prisma.payrollEmployeeProfile.findMany({ where: { employee: { deletedAt: null } }, select: { employeeId: true } });
        if (profiles.length > 0) {
          const snap = await periodBaseSnapshot(profiles.map((p) => p.employeeId));
          await prisma.payrollMonthlyLine.createMany({ data: profiles.map((p) => ({ runId: run!.id, employeeId: p.employeeId, ...(snap.get(p.employeeId) ?? {}) })), skipDuplicates: true });
        }
        // Reporte les primes validées du module sur les lignes (source unique).
        await syncRunPrimes(period, run.id);
      }
      // La ligne du salarié peut manquer (salarié sans fiche paie / ajouté après) :
      // on la crée à la volée.
      // On n'écrit QUE les éléments gérés par le bulletin unitaire (gains + retenues) ;
      // sanction, lignes libres et note restent tels quels (gérés dans la grille).
      const elems = {
        ...(parsed.data.primes != null ? { primes: parsed.data.primes } : {}),
        heuresSup: parsed.data.heures_sup,
        retenueAbsence: parsed.data.retenue_absence,
        avance: parsed.data.avance, pret: parsed.data.pret, retard: parsed.data.retard, autres: parsed.data.autres,
      };
      const snapOne = await periodBaseSnapshot([employeeId]);
      await prisma.payrollMonthlyLine.upsert({
        where: { runId_employeeId: { runId: run.id, employeeId } },
        update: elems,
        create: { runId: run.id, employeeId, ...elems, ...(snapOne.get(employeeId) ?? {}) },
      });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "payroll_monthly_line", entityId: `${period}:${employeeId}`, newValues: parsed.data, ipAddress: request.ip });
      const saved = await prisma.payrollMonthlyLine.findUnique({ where: { runId_employeeId: { runId: run.id, employeeId } } });
      return reply.send({
        period,
        primes: num(saved!.primes),
        heures_sup: num(saved!.heuresSup),
        retenue_absence: num(saved!.retenueAbsence),
        avance: num(saved!.avance),
        pret: num(saved!.pret),
        retard: num(saved!.retard),
        autres: num(saved!.autres),
        sanction: num(saved!.sanction),
        extra_lines: parseExtraLines(saved!.extraLines),
        status: run.status,
        locked: false,
        saved: true,
      });
    },
  );

  // ----- Envoi du bulletin par e-mail (incrément 4) --------------------------
  fastify.post(
    "/api/v1/payroll/employees/:employeeId/payslip/email",
    { preHandler: requirePermission("paie", "consultation") },
    async (request, reply) => {
      const { employeeId } = request.params as { employeeId: string };
      const parsed = z.object({ period: z.string().optional(), message: z.string().max(2000).optional(), to: z.string().email().optional(), preview: z.boolean().optional(), pdf_base64: z.string().optional(), retenue_absence: z.number().optional() }).safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      const period = normalizePeriod(parsed.data.period);
      // Retenue d'absence saisie par le RH (transmise depuis le bulletin), 0 sinon.
      const resolved = await resolvePayslip(employeeId, period, Math.max(parsed.data.retenue_absence ?? 0, 0));
      if ("error" in resolved) return reply.code(resolved.status).send(resolved.error);

      const built = buildPayslipEmail(
        {
          employeeName: resolved.employeeName,
          period,
          matricule: resolved.profile.matricule,
          netAPayer: resolved.payslip.net_a_payer,
          salaireBrut: resolved.payslip.salaire_brut,
          totalRetenuesSalariales: resolved.payslip.total_retenues_salariales,
          coutEmployeur: resolved.payslip.cout_employeur,
        },
        parsed.data.message ?? "",
      );

      // Destinataire par défaut : e-mail de la fiche paie, sinon compte lié.
      const linked = await prisma.user.findFirst({ where: { employeeId, deletedAt: null }, select: { email: true } });
      const defaultTo = resolved.profile.email ?? linked?.email ?? null;

      if (parsed.data.preview) {
        return reply.send({ subject: built.subject, html: built.html, default_to: defaultTo });
      }
      const to = (parsed.data.to ?? defaultTo)?.trim();
      if (!to) return reply.code(400).send({ code: "missing_recipient", message: "Renseignez l'adresse e-mail du salarié (fiche paie ou champ destinataire)." });

      // Bulletin PDF (généré côté navigateur) joint à l'e-mail, s'il est fourni.
      const hasPdf = Boolean(parsed.data.pdf_base64);
      const attachments = parsed.data.pdf_base64
        ? [{ filename: `bulletin-${period}.pdf`, content: Buffer.from(parsed.data.pdf_base64, "base64"), contentType: "application/pdf" }]
        : undefined;

      let sent: boolean;
      let error: string | null = null;
      try {
        const sender = senderIdentity(request.user!);
        sent = await sendMail({ to, subject: built.subject, text: built.text, html: built.html, attachments, ...sender });
      } catch (err) {
        if (err instanceof Error && err.message === "mail_not_configured") {
          return reply.code(503).send({ code: "mail_not_configured", message: "L'envoi d'e-mails n'est pas encore configuré (paramètres SMTP à renseigner sur l'hébergement)." });
        }
        // Échec d'envoi : tracé comme « failed », pour permettre une relance.
        error = err instanceof Error ? err.message : "Échec d'envoi inconnu.";
        const failed = await prisma.payslipDispatch.create({ data: { employeeId, period, recipient: to, status: "failed", error, hasPdf, sentBy: request.user!.id } });
        await writeAuditLog({ userId: request.user!.id, action: "export", entityType: "payslip_email", entityId: `${employeeId}:${period}`, newValues: { to, sent: false, error, dispatch_id: failed.id }, ipAddress: request.ip });
        return reply.code(502).send({ code: "send_failed", message: `Échec de l'envoi : ${error}`, dispatch_id: failed.id });
      }
      // sendMail renvoie false hors configuration SMTP (dev/test) → « en attente ».
      const dispatch = await prisma.payslipDispatch.create({ data: { employeeId, period, recipient: to, status: sent ? "sent" : "pending", hasPdf, sentBy: request.user!.id } });
      await writeAuditLog({ userId: request.user!.id, action: "export", entityType: "payslip_email", entityId: `${employeeId}:${period}`, newValues: { to, sent, has_pdf: hasPdf, dispatch_id: dispatch.id }, ipAddress: request.ip });
      return reply.send({ sent, to, dispatch_id: dispatch.id, status: dispatch.status });
    },
  );

  // Journal des envois de bulletins d'un employé (statut + relance possible).
  fastify.get(
    "/api/v1/payroll/employees/:employeeId/payslip/dispatches",
    { preHandler: requirePermission("paie", "consultation") },
    async (request, reply) => {
      const { employeeId } = request.params as { employeeId: string };
      const q = request.query as { period?: string };
      const rows = await prisma.payslipDispatch.findMany({
        where: { employeeId, ...(q.period ? { period: q.period } : {}) },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return reply.send(rows.map((r) => ({ id: r.id, period: r.period, recipient: r.recipient, status: r.status, error: r.error, has_pdf: r.hasPdf, created_at: r.createdAt })));
    },
  );

  // ----- Livre de paie & clôture (incrément 5) -------------------------------

  // Livre de paie d'une période : une ligne par salarié doté d'une fiche paie.
  fastify.get(
    "/api/v1/payroll/register",
    { preHandler: requirePermission("paie", "consultation") },
    async (request, reply) => {
      const period = normalizePeriod((request.query as { period?: string }).period);
      const reg = await computeRegister(period);
      if ("error" in reg) return reply.code(reg.status).send(reg.error);
      const closure = await prisma.payrollClosure.findUnique({ where: { periodKey: period }, select: { id: true, closedAt: true, closedBy: true } });
      // Contrôle de cohérence (§7) : pour un mois CLÔTURÉ, on compare le net
      // RECALCULÉ (fiche/ligne actuelle) au net FIGÉ dans le journal de clôture.
      // Un écart signale que la clôture a été faite sur d'autres données que
      // celles en vigueur — on l'expose explicitement (jamais en silence).
      let incoherences: { employee_id: string; employee_name: string; net_bulletin: number; net_cloture: number }[] = [];
      if (closure) {
        const journal = await prisma.payrollJournalLine.findMany({ where: { closureId: closure.id }, select: { employeeId: true, employeeName: true, netAPayer: true } });
        const frozen = new Map(journal.map((j) => [j.employeeId, { name: j.employeeName, net: num(j.netAPayer) }]));
        incoherences = reg.lines
          .map((l) => {
            const f = frozen.get(l.employee_id);
            if (!f) return null;
            return Math.round(f.net) !== Math.round(l.net_a_payer)
              ? { employee_id: l.employee_id, employee_name: l.employee_name, net_bulletin: l.net_a_payer, net_cloture: f.net }
              : null;
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
      }
      // Salariés dotés d'une fiche paie mais SANS ligne pour ce mois (ex. fiche
      // créée après la préparation). On ne les ajoute PAS en silence (règle
      // D-041) mais on les SIGNALE : « Préparer le mois » les intègre. Évite
      // qu'un salarié à paie valide (ex. Abou Mbah Séraphine) reste invisible.
      let missing_profiles: { employee_id: string; employee_name: string }[] = [];
      if (!closure) {
        const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period }, select: { id: true } });
        const profiles = await prisma.payrollEmployeeProfile.findMany({ where: { employee: { deletedAt: null } }, select: { employeeId: true, employee: { select: { firstName: true, lastName: true } } } });
        const lineEmp = run ? new Set((await prisma.payrollMonthlyLine.findMany({ where: { runId: run.id }, select: { employeeId: true } })).map((l) => l.employeeId)) : new Set<string>();
        missing_profiles = profiles
          .filter((p) => !lineEmp.has(p.employeeId))
          .map((p) => ({ employee_id: p.employeeId, employee_name: `${p.employee.firstName} ${p.employee.lastName}` }))
          .sort((a, b) => a.employee_name.localeCompare(b.employee_name, "fr"));
      }
      // NB : `reg.monthly_status` (issu de computeRegister) porte déjà le statut
      // du mois (null | brouillon | soumis_dg | valide) — il pilote l'autorisation
      // de clôture côté écran (clôture permise uniquement si « valide »).
      return reply.send({ ...reg, closed: Boolean(closure), closed_at: closure?.closedAt ?? null, incoherences, missing_profiles });
    },
  );

  // DIPE mensuel CNPS : reprend le livre de paie du mois dans les colonnes
  // exactes du « Formulaire de génération du DIPE mensuel » (e-services CNPS),
  // pour saisie/import sur le portail. NB. Jrs = 30 (convention CNPS pour un mois
  // complet). Éléments de salaire exceptionnels = 0 (aucun distinct à ce jour).
  // Colonne IRPP = IRPP seul (le CAC est une taxe communale distincte).
  fastify.get(
    "/api/v1/payroll/dipe",
    { preHandler: requirePermission("paie", "consultation") },
    async (request, reply) => {
      const q = request.query as { period?: string; irpp_mode?: string };
      const period = normalizePeriod(q.period);
      // Colonne IRPP : au Cameroun le DIPE reverse l'impôt sur le revenu total,
      // soit IRPP + CAC (défaut). Le RH peut demander l'IRPP seul (hors centimes
      // additionnels communaux) via irpp_mode=irpp.
      const irppMode = q.irpp_mode === "irpp" ? "irpp" : "irpp_cac";
      const reg = await computeRegister(period);
      if ("error" in reg) return reply.code(reg.status).send(reg.error);

      const idRow = await prisma.setting.findUnique({ where: { key: "publisher_identity" } });
      const identity = (idRow?.value ?? {}) as Record<string, unknown>;
      const [year, month] = period.split("-");
      // DIPE officiel (définitif) uniquement si la paie du mois est validée par le
      // DG ; sinon c'est un aperçu de travail « provisoire » à ne pas déposer.
      const runStatus = (await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period }, select: { status: true } }))?.status ?? null;
      const official = runStatus === "valide";

      const rows = reg.lines.map((l) => ({
        matricule_assure: l.cnps_number ?? "",
        nb_jours: 30,
        salaire_brut: l.salaire_brut,
        elements_exceptionnels: 0,
        salaire_taxable: l.salaire_taxable,
        cotisable_total: l.cnps_cotisable_total,
        cotisable_plafonne: l.assiette_cnps,
        irpp: irppMode === "irpp" ? l.irpp : l.irpp_cac,
        matricule_interne: l.matricule ?? "",
        nom_prenom: l.employee_name,
      }));
      const totals = rows.reduce(
        (t, r) => ({
          salaire_brut: t.salaire_brut + r.salaire_brut,
          salaire_taxable: t.salaire_taxable + r.salaire_taxable,
          cotisable_total: t.cotisable_total + r.cotisable_total,
          cotisable_plafonne: t.cotisable_plafonne + r.cotisable_plafonne,
          irpp: t.irpp + r.irpp,
        }),
        { salaire_brut: 0, salaire_taxable: 0, cotisable_total: 0, cotisable_plafonne: 0, irpp: 0 },
      );

      return reply.send({
        period,
        annee: Number(year),
        mois: Number(month),
        n_dipe: (identity.dipe as string) ?? "",
        cle: (identity.dipe_cle as string) ?? "",
        regime: (identity.cnps_regime as string) || "General",
        irpp_mode: irppMode,
        irpp_label: irppMode === "irpp" ? "IRPP" : "IRPP + CAC",
        effectif: rows.length,
        rows,
        totals,
        run_status: runStatus,
        official,
        official_label: official
          ? "Définitif — paie validée par le Directeur général"
          : "Provisoire — en attente de validation du Directeur général",
        closed: Boolean(await prisma.payrollClosure.findUnique({ where: { periodKey: period }, select: { closedAt: true } })),
      });
    },
  );

  // Clôture / gel d'une période : archive le livre dans le journal immuable.
  // Refusée si la période est déjà clôturée (anti-doublon).
  fastify.post(
    "/api/v1/payroll/register/:period/close",
    { preHandler: requirePermission("paie", "validation") },
    async (request, reply) => {
      const { period } = request.params as { period: string };
      if (!/^\d{4}-\d{2}$/.test(period)) return reply.code(400).send({ code: "validation_error", message: "Période attendue au format AAAA-MM." });
      const existing = await prisma.payrollClosure.findUnique({ where: { periodKey: period } });
      if (existing) return reply.code(409).send({ code: "already_closed", message: "Cette période est déjà clôturée : le journal de paie est figé." });

      // GARDE : la clôture n'est possible QUE si la paie du mois a été VALIDÉE
      // par la Direction générale (statut « valide »). Tant que le DG n'a pas
      // validé (aucun mois préparé, brouillon, ou soumis au DG en attente), la
      // clôture est refusée avec un message explicite.
      const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period }, select: { status: true } });
      if (!run || run.status !== "valide") {
        const message = run?.status === "soumis_dg"
          ? "Clôture impossible : la paie de ce mois est soumise au Directeur général mais n'est PAS ENCORE VALIDÉE. Le DG doit d'abord la valider."
          : run?.status === "brouillon"
            ? "Clôture impossible : la paie de ce mois est en brouillon. Soumettez-la au Directeur général, puis attendez sa validation avant de clôturer."
            : "Clôture impossible : la paie de ce mois n'a pas encore été validée par la Direction générale. Préparez le mois, soumettez-le au DG, puis attendez sa validation avant de clôturer.";
        return reply.code(409).send({ code: "not_validated_by_dg", message });
      }

      const reg = await computeRegister(period);
      if ("error" in reg) return reply.code(reg.status).send(reg.error);
      if (reg.lines.length === 0) return reply.code(409).send({ code: "empty_register", message: "Aucun salarié avec fiche paie : rien à clôturer." });

      const closure = await prisma.$transaction(async (tx) => {
        const c = await tx.payrollClosure.create({
          data: {
            periodKey: period,
            employees: reg.lines.length,
            totalBrut: reg.totals.brut,
            totalNet: reg.totals.net,
            totalChargesPat: reg.totals.charges_pat,
            rateEffectiveFrom: new Date(`${reg.rate_effective_from}T00:00:00.000Z`),
            closedBy: request.user!.id,
          },
        });
        for (const l of reg.lines) {
          await tx.payrollJournalLine.create({
            data: {
              closureId: c.id,
              employeeId: l.employee_id,
              employeeName: l.employee_name,
              matricule: l.matricule,
              cnpsNumber: l.cnps_number,
              niu: l.niu,
              salaireBrut: l.salaire_brut,
              assietteCnps: l.assiette_cnps,
              pvidSalarie: l.pvid_salarie,
              pvidPatronal: l.pvid_patronal,
              prestationsFamiliales: l.prestations_familiales,
              accidentsTravail: l.accidents_travail,
              cfcSalarie: l.cfc_salarie,
              cfcPatronal: l.cfc_patronal,
              fne: l.fne,
              taxeCommunale: l.taxe_communale,
              rav: l.rav,
              irppCac: l.irpp_cac,
              totalRetenuesSalariales: l.total_retenues_salariales,
              totalChargesPatronales: l.total_charges_patronales,
              netAPayer: l.net_a_payer,
              coutEmployeur: l.cout_employeur,
            },
          });
        }
        return c;
      }, { timeout: 120000, maxWait: 15000 });

      await writeAuditLog({ userId: request.user!.id, action: "validate", entityType: "payroll_closure", entityId: period, newValues: { employees: reg.lines.length, total_net: reg.totals.net }, ipAddress: request.ip });
      return reply.send({ period, employees: closure.employees, total_net: Number(closure.totalNet), closed_at: closure.closedAt });
    },
  );

  // ===== Cycle mensuel de paie (grille éditable → validation DG) ==============
  // Étape 1 : préparer le mois pour tous les salariés (brouillon modifiable),
  // saisir les éléments variables par employé, recalcul du net en direct.

  // « Mois de travail » : le RH finalise souvent la paie d'un mois AU DÉBUT du
  // mois suivant (ex. août bouclé début septembre). Pour éviter d'imputer par
  // erreur à septembre des éléments d'août, les écrans se calent par défaut sur
  // le MOIS le plus récent ENCORE OUVERT (brouillon / soumis au DG, non validé),
  // et non sur le mois calendaire. À défaut d'un mois ouvert, on prend le mois
  // calendaire. L'imputation reste toujours faite sur le mois choisi.
  fastify.get(
    "/api/v1/payroll/working-period",
    { preHandler: requirePermission("paie", "consultation") },
    async (_request, reply) => {
      const calendarMonth = new Date().toISOString().slice(0, 7);
      const openRun = await prisma.payrollMonthlyRun.findFirst({
        where: { status: { in: ["brouillon", "soumis_dg"] } },
        orderBy: { periodKey: "desc" },
        select: { periodKey: true, status: true },
      });
      const period = openRun?.periodKey ?? calendarMonth;
      return reply.send({ period, calendar_month: calendarMonth, is_past: period !== calendarMonth, open_status: openRun?.status ?? null });
    },
  );

  // Prépare (ou récupère) le mois : une ligne par salarié doté d'une fiche paie.
  fastify.post(
    "/api/v1/payroll/monthly/:period/prepare",
    { preHandler: requirePermission("paie", "saisie") },
    async (request, reply) => {
      const period = normalizePeriod((request.params as { period: string }).period);
      const [y, m] = period.split("-").map(Number);
      const toDate = new Date(Date.UTC(y, m, 0));
      const rateSet = await prisma.payrollRateSet.findFirst({ where: { active: true, effectiveFrom: { lte: toDate } }, orderBy: { effectiveFrom: "desc" } });
      if (!rateSet) return reply.code(409).send({ code: "no_rate_set", message: "Aucun barème de paie en vigueur pour la période." });

      let run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period } });
      if (!run) {
        run = await prisma.payrollMonthlyRun.create({ data: { periodKey: period, preparedBy: request.user!.id } });
        await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "payroll_monthly_run", entityId: period, ipAddress: request.ip });
      }
      // Complète les lignes manquantes (nouveaux salariés dotés d'une fiche).
      const profiles = await prisma.payrollEmployeeProfile.findMany({ where: { employee: { deletedAt: null } }, select: { employeeId: true } });
      const existing = new Set((await prisma.payrollMonthlyLine.findMany({ where: { runId: run.id }, select: { employeeId: true } })).map((l) => l.employeeId));
      const toCreate = profiles.filter((p) => !existing.has(p.employeeId));
      if (toCreate.length > 0) {
        // Fige le salaire de la période sur chaque nouvelle ligne (indépendance).
        const snap = await periodBaseSnapshot(toCreate.map((p) => p.employeeId));
        await prisma.payrollMonthlyLine.createMany({ data: toCreate.map((p) => ({ runId: run!.id, employeeId: p.employeeId, ...(snap.get(p.employeeId) ?? {}) })) });
      }
      // Reporte les primes déjà validées du module « Primes du mois » sur les
      // lignes du mois (source unique des primes).
      await syncRunPrimes(period, run.id);
      return reply.send({ period, status: run.status });
    },
  );

  // Récupère le mois : statut + lignes (éléments variables) + bulletin recalculé.
  fastify.get(
    "/api/v1/payroll/monthly/:period",
    { preHandler: requirePermission("paie", "consultation") },
    async (request, reply) => {
      const period = normalizePeriod((request.params as { period: string }).period);
      const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period } });
      if (!run) return reply.send({ exists: false, period });

      const [y, m] = period.split("-").map(Number);
      const toDate = new Date(Date.UTC(y, m, 0));
      const rateSet = await prisma.payrollRateSet.findFirst({ where: { active: true, effectiveFrom: { lte: toDate } }, orderBy: { effectiveFrom: "desc" } });
      if (!rateSet) return reply.code(409).send({ code: "no_rate_set", message: "Aucun barème de paie en vigueur pour la période." });
      const rates = ratesFrom(rateSet as unknown as Record<string, unknown>);
      const formulas = await loadFormulaOverlay();

      // Correction (D-041) : plus d'auto-complétion silencieuse à la consultation.
      // Le contenu d'un mois est EXPLICITE — peuplé par « Préparer le mois » et
      // ajustable ligne par ligne (une fiche retirée du mois ne réapparaît pas
      // toute seule). Un salarié doté d'une fiche mais absent du mois est signalé
      // dans « missing_profiles » (ci-dessous) pour que le RH puisse re-préparer.
      // Les primes validées restent synchronisées sur les lignes existantes.
      if (run.status === "brouillon") await syncRunPrimes(period, run.id);

      const lines = await prisma.payrollMonthlyLine.findMany({
        where: { runId: run.id },
        include: {
          employee: {
            select: {
              id: true, firstName: true, lastName: true, position: true, hireDate: true, birthDate: true, leaveBalanceDays: true, maritalStatus: true, childrenCount: true, phone: true, emergencyContact: true, niu: true, leaveTakenDays: true,
              department: { select: { name: true } },
              hrContracts: { orderBy: { startDate: "desc" }, take: 1, select: { type: true } },
              payrollProfile: true,
              confidential: { select: { baseSalary: true } },
            },
          },
        },
        orderBy: { employee: { lastName: "asc" } },
      });

      const rubriques = await activeRubriqueMap();
      const rows = lines
        .filter((l) => l.employee.payrollProfile)
        .map((l) => {
          const p = l.employee.payrollProfile!;
          const confBase = l.employee.confidential?.baseSalary != null ? num(l.employee.confidential.baseSalary) : null;
          const slip = computeMonthlyLine(p, rates, l, confBase, formulas, rubriques);
          // Salaire de la PÉRIODE (figé sur la ligne) — MÊME assiette que le calcul
          // du net (resolveLineBasis) : ce qui est affiché « salaire de ce mois »
          // est exactement ce qui produit le net. Repli fiche pour ligne ancienne.
          const periodBasis = resolveLineBasis(p, l, confBase);
          return {
            employee_id: l.employeeId,
            employee_name: `${l.employee.firstName} ${l.employee.lastName}`,
            period_base_salary: periodBasis.base,
            period_gross_contractual: periodBasis.gross,
            matricule: p.matricule,
            cnps_number: p.cnpsNumber,
            // NIU : on préfère celui saisi sur la fiche RH (identité de l'employé),
            // avec repli sur le profil de paie pour les données antérieures.
            niu: l.employee.niu ?? p.niu,
            fiscal_parts: num(p.fiscalParts),
            // Informations salarié pour le bulletin (modèle du classeur).
            department: l.employee.department?.name ?? null,
            position: l.employee.position ?? null,
            hire_date: l.employee.hireDate ? l.employee.hireDate.toISOString().slice(0, 10) : null,
            birth_date: l.employee.birthDate ? l.employee.birthDate.toISOString().slice(0, 10) : null,
            marital_status: l.employee.maritalStatus,
            children_count: l.employee.childrenCount,
            phone: l.employee.phone,
            emergency_contact: l.employee.emergencyContact,
            leave_taken: l.employee.leaveTakenDays != null ? num(l.employee.leaveTakenDays) : null,
            contract_type: l.employee.hrContracts[0]?.type ?? null,
            category: p.category,
            email: p.email,
            payment_mode: p.paymentMode,
            account_number: p.accountNumber,
            leave_balance: num(l.employee.leaveBalanceDays),
            elements: monthlyElements(l),
            extra_lines: parseExtraLines(l.extraLines),
            note: l.note,
            net_a_payer: slip.net_a_payer,
            salaire_brut: slip.salaire_brut,
            total_retenues_salariales: slip.total_retenues_salariales,
            total_charges_patronales: slip.total_charges_patronales,
            cout_employeur: slip.cout_employeur,
            // Bulletin complet, pour l'impression groupée des bulletins PDF.
            payslip: slip,
          };
        });
      const totals = rows.reduce(
        (acc, r) => ({ brut: acc.brut + r.salaire_brut, net: acc.net + r.net_a_payer, cout: acc.cout + r.cout_employeur }),
        { brut: 0, net: 0, cout: 0 },
      );
      // Salariés ACTIFS absents de la grille du mois : soit sans fiche paie (à
      // compléter), soit dotés d'une fiche mais pas encore ajoutés à ce mois
      // (fiche créée après la préparation, ou ligne retirée). On les remonte pour
      // que le RH sache qui manque et puisse re-préparer le mois s'il le souhaite.
      const inMonth = new Set(lines.map((l) => l.employeeId));
      const missing = await prisma.employee.findMany({
        where: { deletedAt: null, id: { notIn: [...inMonth] } },
        select: { id: true, firstName: true, lastName: true, department: { select: { name: true } }, payrollProfile: { select: { employeeId: true } } },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      });
      const missingProfiles = missing.map((e) => ({ employee_id: e.id, name: `${e.firstName} ${e.lastName}`, department: e.department?.name ?? null, has_fiche: e.payrollProfile != null }));
      return reply.send({ exists: true, period, status: run.status, validated_at: run.validatedAt, submitted_at: run.submittedAt, return_reason: run.returnReason, returned_at: run.returnedAt, rate_effective_from: rateSet.effectiveFrom.toISOString().slice(0, 10), rates: rateDisplay(rateSet as unknown as Record<string, unknown>), lines: rows, totals, missing_profiles: missingProfiles });
    },
  );

  // Saisie des éléments variables d'un salarié (brouillon uniquement).
  fastify.patch(
    "/api/v1/payroll/monthly/:period/lines/:employeeId",
    { preHandler: requirePermission("paie", "saisie") },
    async (request, reply) => {
      const period = normalizePeriod((request.params as { period: string }).period);
      const { employeeId } = request.params as { employeeId: string };
      const parsed = monthlyLineSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });

      const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period } });
      if (!run) return reply.code(404).send({ code: "not_found", message: "Mois non préparé." });
      if (run.status === "valide") return reply.code(409).send({ code: "run_locked", message: "Mois validé par la Direction : il n'est plus modifiable. Rouvrez-le pour corriger." });
      if (run.status === "soumis_dg") return reply.code(409).send({ code: "run_submitted", message: "Mois soumis au Directeur général : en attente de validation, il n'est plus modifiable. Le DG doit le valider ou le retourner pour correction." });

      const b = parsed.data;
      await prisma.payrollMonthlyLine.update({
        where: { runId_employeeId: { runId: run.id, employeeId } },
        data: {
          // Salaire de la période : corrigé pour CE mois seulement si fourni.
          ...(b.base_salary != null ? { baseSalary: b.base_salary } : {}),
          ...(b.gross_contractual != null ? { grossContractual: b.gross_contractual } : {}),
          // `primes` n'est écrit que s'il est explicitement fourni (compat) ;
          // sinon on préserve la valeur gérée par le module « Primes du mois ».
          ...(b.primes != null ? { primes: b.primes } : {}),
          heuresSup: b.heures_sup, retenueAbsence: b.retenue_absence,
          retard: b.retard, avance: b.avance, pret: b.pret, sanction: b.sanction, autres: b.autres,
          extraLines: b.extra_lines ?? [],
          note: b.note,
        },
      });
      return reply.send({ ok: true });
    },
  );

  // Suppression d'une fiche de paie du mois (§6) : retire un salarié de CE mois
  // uniquement, sur une période non clôturée et non verrouillée. La suppression
  // ne touche pas la fiche permanente ni les autres périodes. Traçée au journal.
  fastify.delete(
    "/api/v1/payroll/monthly/:period/lines/:employeeId",
    { preHandler: requirePermission("paie", "saisie") },
    async (request, reply) => {
      const period = normalizePeriod((request.params as { period: string }).period);
      const { employeeId } = request.params as { employeeId: string };
      const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period } });
      if (!run) return reply.code(404).send({ code: "not_found", message: "Mois non préparé." });
      if (run.status === "valide") return reply.code(409).send({ code: "run_locked", message: "Mois validé par la Direction : rouvrez-le pour corriger." });
      if (run.status === "soumis_dg") return reply.code(409).send({ code: "run_submitted", message: "Mois soumis au Directeur général : non modifiable." });
      const line = await prisma.payrollMonthlyLine.findUnique({ where: { runId_employeeId: { runId: run.id, employeeId } } });
      if (!line) return reply.code(404).send({ code: "not_found", message: "Aucune fiche de paie pour ce salarié sur ce mois." });
      await prisma.payrollMonthlyLine.delete({ where: { runId_employeeId: { runId: run.id, employeeId } } });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "payroll_monthly_line", entityId: `${period}:${employeeId}`, newValues: { removed_from_month: true, period, employeeId }, ipAddress: request.ip });
      return reply.send({ ok: true });
    },
  );

  // Contrôles & anomalies d'un mois (§18) : liste bloquantes + signalées.
  fastify.get(
    "/api/v1/payroll/monthly/:period/anomalies",
    { preHandler: requirePermission("paie", "consultation") },
    async (request, reply) => {
      const period = normalizePeriod((request.params as { period: string }).period);
      const { blocking, warnings } = await computeAnomalies(period);
      return reply.send({ period, blocking, warnings, can_submit: blocking.length === 0 });
    },
  );

  // Soumission de la paie au DG (RH) : brouillon → soumis_dg. La grille se fige
  // (en attente de validation) ; le DG doit valider ou retourner pour correction.
  fastify.post(
    "/api/v1/payroll/monthly/:period/submit",
    { preHandler: requirePermission("paie", "saisie") },
    async (request, reply) => {
      const period = normalizePeriod((request.params as { period: string }).period);
      const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period }, include: { _count: { select: { lines: true } } } });
      if (!run) return reply.code(404).send({ code: "not_found", message: "Mois non préparé." });
      if (run.status === "valide") return reply.code(409).send({ code: "already_validated", message: "Ce mois est déjà validé." });
      if (run.status === "soumis_dg") return reply.code(409).send({ code: "already_submitted", message: "Ce mois est déjà soumis au Directeur général." });
      if (run._count.lines === 0) return reply.code(409).send({ code: "empty_run", message: "Aucun salarié dans ce mois : rien à soumettre." });
      // §18 — contrôle automatique AVANT soumission : bloque s'il subsiste une
      // anomalie bloquante (fiche/ salaire manquant, net négatif…).
      const { blocking } = await computeAnomalies(period);
      if (blocking.length > 0) {
        return reply.code(409).send({
          code: "anomalies_blocking",
          message: `Anomalie de paie — correction requise (${blocking.length}) : ${blocking.map((a) => `${a.employee_name} — ${a.message}`).join(" ; ")}`,
          anomalies: blocking,
        });
      }
      await prisma.payrollMonthlyRun.update({ where: { id: run.id }, data: { status: "soumis_dg", submittedBy: request.user!.id, submittedAt: new Date(), returnReason: null } });
      await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "payroll_monthly_run", entityId: period, newValues: { status: "soumis_dg" }, ipAddress: request.ip });
      // Le DG est prévenu qu'une paie l'attend. Sans montants nominatifs (données
      // confidentielles) : juste le mois et le nombre de bulletins.
      for (const roleCode of DG_ROLES) {
        await notifyRole({
          roleCode, type: "validation", priority: "high",
          title: `Paie de ${period} à valider`,
          body: `Le RH a soumis la paie de ${period} (${run._count.lines} bulletin(s)). À valider ou à retourner pour correction.`,
          entityType: "payroll_monthly_run", entityId: period,
        }).catch(() => {});
      }
      return reply.send({ period, status: "soumis_dg" });
    },
  );

  // Retour de la paie au RH pour correction (DG) : soumis_dg → brouillon, avec un
  // MOTIF obligatoire (§11, état 4A). La grille redevient modifiable.
  fastify.post(
    "/api/v1/payroll/monthly/:period/return",
    { preHandler: requirePermission("paie", "validation") },
    async (request, reply) => {
      if (!request.user!.roles.some((r) => r === "DIR_GENERAL" || r === "ADMIN_GENERAL")) {
        return reply.code(403).send({ code: "dg_only", message: "Retour au RH réservé au Directeur général." });
      }
      const period = normalizePeriod((request.params as { period: string }).period);
      const parsed = z.object({ reason: z.string().min(3).max(2000) }).safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ code: "reason_required", message: "Motif du retour obligatoire : précisez ce que le RH doit corriger." });
      const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period } });
      if (!run) return reply.code(404).send({ code: "not_found", message: "Mois non préparé." });
      if (run.status !== "soumis_dg") return reply.code(409).send({ code: "not_submitted", message: "Seule une paie soumise au DG peut être retournée pour correction." });
      const submitter = run.submittedBy; // capturé avant remise à null
      await prisma.payrollMonthlyRun.update({
        where: { id: run.id },
        data: { status: "brouillon", returnReason: parsed.data.reason, returnedBy: request.user!.id, returnedAt: new Date(), submittedBy: null, submittedAt: null },
      });
      await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "payroll_monthly_run", entityId: period, newValues: { status: "brouillon", returned: true, reason: parsed.data.reason }, ipAddress: request.ip });
      // Le RH qui a soumis (à défaut, le service RH) est prévenu, avec le motif.
      const returnNotif = {
        type: "autre" as const, priority: "high" as const,
        title: `Paie de ${period} retournée pour correction`,
        body: `Le Directeur général a retourné la paie de ${period}. Motif : ${parsed.data.reason}. La grille est de nouveau modifiable.`,
        entityType: "payroll_monthly_run", entityId: period,
      };
      if (submitter) await notifyUsers({ userIds: [submitter], ...returnNotif }).catch(() => {});
      else await notifyRole({ roleCode: RH_ROLE, ...returnNotif }).catch(() => {});
      return reply.send({ period, status: "brouillon", return_reason: parsed.data.reason });
    },
  );

  // Validation du mois par le DIRECTEUR GÉNÉRAL (obligatoire avant impression) :
  // fige le mois. Le droit `paie:validation` est partagé (RH/Finance/DG) ; ici la
  // validation DÉFINITIVE est réservée au DG (ou à l'administrateur général).
  fastify.post(
    "/api/v1/payroll/monthly/:period/validate",
    { preHandler: requirePermission("paie", "validation") },
    async (request, reply) => {
      if (!request.user!.roles.some((r) => r === "DIR_GENERAL" || r === "ADMIN_GENERAL")) {
        return reply.code(403).send({ code: "dg_only", message: "Validation réservée au Directeur général : seule la Direction générale peut valider la paie du mois avant impression." });
      }
      const period = normalizePeriod((request.params as { period: string }).period);
      const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period }, include: { _count: { select: { lines: true } } } });
      if (!run) return reply.code(404).send({ code: "not_found", message: "Mois non préparé." });
      if (run.status === "valide") return reply.code(409).send({ code: "already_validated", message: "Ce mois est déjà validé." });
      if (run._count.lines === 0) return reply.code(409).send({ code: "empty_run", message: "Aucun salarié dans ce mois : rien à valider." });
      const submitter = run.submittedBy;
      await prisma.payrollMonthlyRun.update({ where: { id: run.id }, data: { status: "valide", validatedBy: request.user!.id, validatedAt: new Date() } });
      await writeAuditLog({ userId: request.user!.id, action: "validate", entityType: "payroll_monthly_run", entityId: period, ipAddress: request.ip });
      // Le RH est informé de la validation (entérinement).
      const rhNotif = {
        type: "validation" as const, priority: "medium" as const,
        title: `Paie de ${period} validée`,
        body: `Le Directeur général a validé (entériné) la paie de ${period}. Les bulletins peuvent être édités et transmis.`,
        entityType: "payroll_monthly_run", entityId: period,
      };
      if (submitter) await notifyUsers({ userIds: [submitter], ...rhNotif }).catch(() => {});
      else await notifyRole({ roleCode: RH_ROLE, ...rhNotif }).catch(() => {});
      // Le DAF est mis dans la boucle pour le SUIVI : décaissement + déclarations
      // (CNPS/DIPE, impôts). Sans montants nominatifs (confidentialité).
      await notifyRole({
        roleCode: DAF_ROLE, type: "validation", priority: "high",
        title: `Paie de ${period} validée — à prendre en charge`,
        body: `La paie de ${period} (${run._count.lines} bulletin(s)) est validée par le Directeur général. À décaisser et à déclarer (CNPS/DIPE, impôts).`,
        entityType: "payroll_monthly_run", entityId: period,
      }).catch(() => {});
      return reply.send({ period, status: "valide" });
    },
  );

  // Réouverture du mois (DG) : repasse en brouillon pour corriger. Refusée si le
  // livre de paie de la période est déjà clôturé (journal figé, définitif).
  fastify.post(
    "/api/v1/payroll/monthly/:period/reopen",
    { preHandler: requirePermission("paie", "validation") },
    async (request, reply) => {
      if (!request.user!.roles.some((r) => r === "DIR_GENERAL" || r === "ADMIN_GENERAL")) {
        return reply.code(403).send({ code: "dg_only", message: "Réouverture réservée au Directeur général." });
      }
      const period = normalizePeriod((request.params as { period: string }).period);
      // Motif facultatif : quand le DG rouvre une paie validée pour la renvoyer
      // au RH « pour correction », il précise ce qui doit être corrigé — c'est
      // enregistré comme motif de retour (le RH voit alors ce qu'il doit reprendre).
      const parsed = z.object({ reason: z.string().trim().min(1).optional() }).safeParse(request.body ?? {});
      const reason = parsed.success ? parsed.data.reason : undefined;
      const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period } });
      if (!run) return reply.code(404).send({ code: "not_found", message: "Mois non préparé." });
      const closure = await prisma.payrollClosure.findUnique({ where: { periodKey: period }, select: { id: true } });
      if (closure) return reply.code(409).send({ code: "already_closed", message: "Livre de paie clôturé : le mois est définitif et ne peut plus être rouvert." });
      await prisma.payrollMonthlyRun.update({
        where: { id: run.id },
        data: reason
          ? { status: "brouillon", validatedBy: null, validatedAt: null, returnReason: reason, returnedBy: request.user!.id, returnedAt: new Date() }
          : { status: "brouillon", validatedBy: null, validatedAt: null },
      });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "payroll_monthly_run", entityId: period, newValues: { reopened: true, ...(reason ? { returned: true, reason } : {}) }, ipAddress: request.ip });
      // Réouverture « pour correction » : le RH (celui qui a préparé, à défaut le
      // service RH) est prévenu avec le motif.
      if (reason) {
        const reopenNotif = {
          type: "autre" as const, priority: "high" as const,
          title: `Paie de ${period} renvoyée pour correction`,
          body: `Le Directeur général a rouvert la paie de ${period} pour correction. Motif : ${reason}. La grille est de nouveau modifiable.`,
          entityType: "payroll_monthly_run", entityId: period,
        };
        if (run.submittedBy) await notifyUsers({ userIds: [run.submittedBy], ...reopenNotif }).catch(() => {});
        else await notifyRole({ roleCode: RH_ROLE, ...reopenNotif }).catch(() => {});
      }
      return reply.send({ period, status: "brouillon", return_reason: reason ?? null });
    },
  );

  // ===== Suivi de prise en charge par le DAF + fil de validation (Temps 2) =====
  // Après validation DG, le DAF pilote l'après : décaissement + déclarations +
  // archivage, puis clôture le suivi. Lecture ouverte à la paie (DG/RH/DAF) ;
  // écriture réservée au DAF (finance:validation) — le RH ne l'a pas.

  // État du suivi + fil de validation daté (préparé → soumis → validé → pris en
  // charge → clôturé).
  fastify.get(
    "/api/v1/payroll/monthly/:period/handoff",
    { preHandler: requirePermission("paie", "consultation") },
    async (request, reply) => {
      const period = normalizePeriod((request.params as { period: string }).period);
      const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period } });
      if (!run) return reply.code(404).send({ code: "not_found", message: "Mois non préparé." });
      const h = await prisma.payrollHandoff.findUnique({ where: { periodKey: period } });

      const ids = [run.preparedBy, run.submittedBy, run.validatedBy, run.returnedBy, h?.salariesPaidBy, h?.cnpsDeclaredBy, h?.taxDeclaredBy, h?.archivedBy, h?.closedBy].filter((x): x is string => Boolean(x));
      const users = ids.length ? await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, username: true } }) : [];
      const name = (id: string | null | undefined) => (id ? users.find((u) => u.id === id)?.username ?? null : null);

      const items = [
        { key: "salaries_paid", label: "Salaires décaissés", done: Boolean(h?.salariesPaidAt), at: h?.salariesPaidAt ?? null, by: name(h?.salariesPaidBy), ref: null as string | null },
        { key: "cnps_declared", label: "CNPS / DIPE déclarée", done: Boolean(h?.cnpsDeclaredAt), at: h?.cnpsDeclaredAt ?? null, by: name(h?.cnpsDeclaredBy), ref: h?.cnpsRef ?? null },
        { key: "tax_declared", label: "Impôts (IRPP/CAC) déclarés", done: Boolean(h?.taxDeclaredAt), at: h?.taxDeclaredAt ?? null, by: name(h?.taxDeclaredBy), ref: h?.taxRef ?? null },
        { key: "archived", label: "Bulletins archivés", done: Boolean(h?.archivedAt), at: h?.archivedAt ?? null, by: name(h?.archivedBy), ref: null as string | null },
      ];
      const timeline = [
        { step: "prepare", label: "Paie préparée", at: run.createdAt, by: name(run.preparedBy), note: null as string | null },
        run.submittedAt ? { step: "submit", label: "Soumise au Directeur général", at: run.submittedAt, by: name(run.submittedBy), note: null } : null,
        run.returnedAt ? { step: "return", label: "Retournée pour correction", at: run.returnedAt, by: name(run.returnedBy), note: run.returnReason } : null,
        run.validatedAt ? { step: "validate", label: "Validée par le Directeur général", at: run.validatedAt, by: name(run.validatedBy), note: null } : null,
        h?.salariesPaidAt ? { step: "paid", label: "Salaires décaissés", at: h.salariesPaidAt, by: name(h.salariesPaidBy), note: null } : null,
        h?.cnpsDeclaredAt ? { step: "cnps", label: "CNPS / DIPE déclarée", at: h.cnpsDeclaredAt, by: name(h.cnpsDeclaredBy), note: h.cnpsRef } : null,
        h?.taxDeclaredAt ? { step: "tax", label: "Impôts déclarés", at: h.taxDeclaredAt, by: name(h.taxDeclaredBy), note: h.taxRef } : null,
        h?.archivedAt ? { step: "archived", label: "Bulletins archivés", at: h.archivedAt, by: name(h.archivedBy), note: null } : null,
        h?.closedAt ? { step: "closed", label: "Suivi clôturé par le DAF", at: h.closedAt, by: name(h.closedBy), note: null } : null,
      ].filter((x): x is NonNullable<typeof x> => x !== null);

      return reply.send({
        period,
        run_status: run.status,
        validated: run.status === "valide",
        closed: Boolean(h?.closedAt),
        all_items_done: items.every((i) => i.done),
        items,
        timeline,
      });
    },
  );

  // Le DAF coche/décoche les étapes de prise en charge (avec réf. CNPS / impôt).
  fastify.put(
    "/api/v1/payroll/monthly/:period/handoff",
    { preHandler: requirePermission("finance", "validation") },
    async (request, reply) => {
      const period = normalizePeriod((request.params as { period: string }).period);
      const parsed = z
        .object({
          salaries_paid: z.boolean().optional(),
          cnps_declared: z.boolean().optional(),
          cnps_ref: z.string().max(120).nullable().optional(),
          tax_declared: z.boolean().optional(),
          tax_ref: z.string().max(120).nullable().optional(),
          archived: z.boolean().optional(),
        })
        .safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period } });
      if (!run) return reply.code(404).send({ code: "not_found", message: "Mois non préparé." });
      if (run.status !== "valide") return reply.code(409).send({ code: "not_validated", message: "La paie doit être validée par le Directeur général avant le suivi du DAF." });
      const existing = await prisma.payrollHandoff.findUnique({ where: { periodKey: period } });
      if (existing?.closedAt) return reply.code(409).send({ code: "handoff_closed", message: "Le suivi de ce mois est clôturé : rouvrez-le avant de le modifier." });

      const now = new Date();
      const uid = request.user!.id;
      const b = parsed.data;
      const data: Record<string, unknown> = {};
      if (b.salaries_paid !== undefined) { data.salariesPaidAt = b.salaries_paid ? now : null; data.salariesPaidBy = b.salaries_paid ? uid : null; }
      if (b.cnps_declared !== undefined) { data.cnpsDeclaredAt = b.cnps_declared ? now : null; data.cnpsDeclaredBy = b.cnps_declared ? uid : null; }
      if (b.tax_declared !== undefined) { data.taxDeclaredAt = b.tax_declared ? now : null; data.taxDeclaredBy = b.tax_declared ? uid : null; }
      if (b.archived !== undefined) { data.archivedAt = b.archived ? now : null; data.archivedBy = b.archived ? uid : null; }
      if (b.cnps_ref !== undefined) data.cnpsRef = b.cnps_ref;
      if (b.tax_ref !== undefined) data.taxRef = b.tax_ref;

      const h = await prisma.payrollHandoff.upsert({ where: { periodKey: period }, update: data, create: { periodKey: period, ...data } });
      await writeAuditLog({ userId: uid, action: "update", entityType: "payroll_handoff", entityId: period, newValues: b, ipAddress: request.ip });
      return reply.send({ period, closed: Boolean(h.closedAt) });
    },
  );

  // Clôture du suivi par le DAF : possible seulement si les quatre étapes sont
  // faites. Notifie le DG que le cycle de paie du mois est bouclé.
  fastify.post(
    "/api/v1/payroll/monthly/:period/handoff/close",
    { preHandler: requirePermission("finance", "validation") },
    async (request, reply) => {
      const period = normalizePeriod((request.params as { period: string }).period);
      const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period } });
      if (!run) return reply.code(404).send({ code: "not_found", message: "Mois non préparé." });
      if (run.status !== "valide") return reply.code(409).send({ code: "not_validated", message: "La paie doit être validée par le Directeur général avant de clôturer le suivi." });
      const h = await prisma.payrollHandoff.findUnique({ where: { periodKey: period } });
      const done = Boolean(h?.salariesPaidAt) && Boolean(h?.cnpsDeclaredAt) && Boolean(h?.taxDeclaredAt) && Boolean(h?.archivedAt);
      if (!done) return reply.code(409).send({ code: "handoff_incomplete", message: "Suivi incomplet : décaissement, déclarations CNPS et impôts, et archivage doivent être faits avant la clôture." });
      if (h?.closedAt) return reply.code(409).send({ code: "already_closed", message: "Le suivi de ce mois est déjà clôturé." });
      await prisma.payrollHandoff.update({ where: { periodKey: period }, data: { closedAt: new Date(), closedBy: request.user!.id } });
      await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "payroll_handoff", entityId: period, newValues: { closed: true }, ipAddress: request.ip });
      for (const roleCode of DG_ROLES) {
        await notifyRole({
          roleCode, type: "validation", priority: "medium",
          title: `Paie de ${period} — cycle bouclé`,
          body: `Le DAF a clôturé le suivi de la paie de ${period} : salaires décaissés, CNPS et impôts déclarés, bulletins archivés.`,
          entityType: "payroll_handoff", entityId: period,
        }).catch(() => {});
      }
      return reply.send({ period, closed: true });
    },
  );

  // Réouverture du suivi (règle d'or : toujours pouvoir corriger).
  fastify.post(
    "/api/v1/payroll/monthly/:period/handoff/reopen",
    { preHandler: requirePermission("finance", "validation") },
    async (request, reply) => {
      const period = normalizePeriod((request.params as { period: string }).period);
      const h = await prisma.payrollHandoff.findUnique({ where: { periodKey: period } });
      if (!h?.closedAt) return reply.code(409).send({ code: "not_closed", message: "Le suivi de ce mois n'est pas clôturé." });
      await prisma.payrollHandoff.update({ where: { periodKey: period }, data: { closedAt: null, closedBy: null } });
      await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "payroll_handoff", entityId: period, newValues: { reopened: true }, ipAddress: request.ip });
      return reply.send({ period, closed: false });
    },
  );

  // ----- Réouverture EXCEPTIONNELLE d'une paie verrouillée (ch. 23) -----------

  // Le RH DEMANDE la réouverture d'un mois VALIDÉ (verrouillé) : il ne peut plus
  // corriger directement. Élément concerné, ancienne valeur, correction, motif.
  fastify.post(
    "/api/v1/payroll/monthly/:period/reopen-request",
    { preHandler: requirePermission("paie", "saisie") },
    async (request, reply) => {
      const period = normalizePeriod((request.params as { period: string }).period);
      const parsed = z
        .object({
          employee_id: z.string().uuid().nullable().optional(),
          element: z.string().min(2).max(120),
          old_value: z.string().max(200).nullable().optional(),
          requested_correction: z.string().min(2).max(500),
          reason: z.string().min(3).max(2000),
        })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides : élément, correction demandée et motif sont requis.", details: parsed.error.issues });
      const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period } });
      if (!run) return reply.code(404).send({ code: "not_found", message: "Mois non préparé." });
      if (run.status !== "valide") return reply.code(409).send({ code: "not_locked", message: "La réouverture exceptionnelle ne concerne qu'une paie validée et verrouillée." });
      const pending = await prisma.payrollReopenRequest.findFirst({ where: { periodKey: period, status: "en_attente" } });
      if (pending) return reply.code(409).send({ code: "request_pending", message: "Une demande de réouverture est déjà en attente pour ce mois." });
      const b = parsed.data;
      const created = await prisma.payrollReopenRequest.create({
        data: { periodKey: period, employeeId: b.employee_id ?? null, element: b.element, oldValue: b.old_value ?? null, requestedCorrection: b.requested_correction, reason: b.reason, requestedBy: request.user!.id },
      });
      await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "payroll_reopen_request", entityId: created.id, newValues: { period, element: b.element, reason: b.reason }, ipAddress: request.ip });
      return reply.code(201).send({ id: created.id, status: created.status });
    },
  );

  // Liste des demandes de réouverture d'un mois (RH + DG).
  fastify.get(
    "/api/v1/payroll/monthly/:period/reopen-requests",
    { preHandler: requirePermission("paie", "consultation") },
    async (request, reply) => {
      const period = normalizePeriod((request.params as { period: string }).period);
      const rows = await prisma.payrollReopenRequest.findMany({ where: { periodKey: period }, orderBy: { requestedAt: "desc" }, take: 50 });
      const ids = [...new Set(rows.flatMap((r) => [r.requestedBy, r.decidedBy]).filter((x): x is string => Boolean(x)))];
      const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } }) : [];
      const name = (id: string | null) => (id ? users.find((u) => u.id === id)?.username ?? null : null);
      const empIds = [...new Set(rows.map((r) => r.employeeId).filter((x): x is string => Boolean(x)))];
      const emps = empIds.length ? await prisma.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, firstName: true, lastName: true } }) : [];
      const empName = (id: string | null) => (id ? (() => { const e = emps.find((x) => x.id === id); return e ? `${e.firstName} ${e.lastName}` : null; })() : null);
      return reply.send(
        rows.map((r) => ({
          id: r.id, status: r.status, element: r.element, old_value: r.oldValue, requested_correction: r.requestedCorrection, reason: r.reason,
          employee_id: r.employeeId, employee_name: empName(r.employeeId),
          requested_by: name(r.requestedBy), requested_at: r.requestedAt,
          decided_by: name(r.decidedBy), decided_at: r.decidedAt, decision_reason: r.decisionReason,
        })),
      );
    },
  );

  // Le DG AUTORISE ou REFUSE la demande. L'autorisation repasse le mois en
  // brouillon (il refait ensuite le circuit normal de validation).
  fastify.post(
    "/api/v1/payroll/reopen-requests/:id/decide",
    { preHandler: requirePermission("paie", "validation") },
    async (request, reply) => {
      if (!request.user!.roles.some((r) => r === "DIR_GENERAL" || r === "ADMIN_GENERAL")) {
        return reply.code(403).send({ code: "dg_only", message: "Décision réservée au Directeur général." });
      }
      const { id } = request.params as { id: string };
      const parsed = z.object({ decision: z.enum(["autorisee", "refusee"]), decision_reason: z.string().max(2000).optional() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Décision invalide." });
      const req = await prisma.payrollReopenRequest.findUnique({ where: { id } });
      if (!req) return reply.code(404).send({ code: "not_found", message: "Demande introuvable." });
      if (req.status !== "en_attente") return reply.code(409).send({ code: "already_decided", message: "Cette demande a déjà été traitée." });

      if (parsed.data.decision === "autorisee") {
        const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: req.periodKey } });
        if (!run) return reply.code(404).send({ code: "not_found", message: "Mois non préparé." });
        const closure = await prisma.payrollClosure.findUnique({ where: { periodKey: req.periodKey }, select: { id: true } });
        if (closure) return reply.code(409).send({ code: "already_closed", message: "Livre de paie clôturé : le mois est définitif et ne peut plus être rouvert." });
        await prisma.$transaction([
          prisma.payrollReopenRequest.update({ where: { id }, data: { status: "autorisee", decidedBy: request.user!.id, decidedAt: new Date(), decisionReason: parsed.data.decision_reason ?? null } }),
          prisma.payrollMonthlyRun.update({ where: { id: run.id }, data: { status: "brouillon", validatedBy: null, validatedAt: null } }),
        ]);
        await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "payroll_reopen_request", entityId: id, newValues: { decision: "autorisee", period: req.periodKey, reopened: true }, ipAddress: request.ip });
        return reply.send({ id, status: "autorisee", period: req.periodKey, run_status: "brouillon" });
      }

      await prisma.payrollReopenRequest.update({ where: { id }, data: { status: "refusee", decidedBy: request.user!.id, decidedAt: new Date(), decisionReason: parsed.data.decision_reason ?? null } });
      await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "payroll_reopen_request", entityId: id, newValues: { decision: "refusee", period: req.periodKey }, ipAddress: request.ip });
      return reply.send({ id, status: "refusee" });
    },
  );

  // Journal de paie archivé d'une période clôturée.
  fastify.get(
    "/api/v1/payroll/journal/:period",
    { preHandler: requirePermission("paie", "consultation") },
    async (request, reply) => {
      const { period } = request.params as { period: string };
      const closure = await prisma.payrollClosure.findUnique({
        where: { periodKey: period },
        include: { lines: { orderBy: { employeeName: "asc" } } },
      });
      if (!closure) return reply.code(404).send({ code: "not_found", message: "Période non clôturée." });
      return reply.send({
        period,
        closed_at: closure.closedAt,
        employees: closure.employees,
        totals: { brut: Number(closure.totalBrut), net: Number(closure.totalNet), charges_pat: Number(closure.totalChargesPat) },
        lines: closure.lines.map(journalLineView),
      });
    },
  );
}

function normalizePeriod(p?: string): string {
  return p && /^\d{4}-\d{2}$/.test(p) ? p : new Date().toISOString().slice(0, 7);
}

// Calcul du bulletin réutilisable (consultation + e-mail). Renvoie une erreur
// structurée (status + payload) plutôt qu'une exception.
// Salaire de base de référence : le SALAIRE DE BASE CONFIDENTIEL fait foi
// (décision opérateur 12/08/2026 : c'est lui qui « fait foi », le moteur le
// prend en compte). À défaut (aucune valeur confidentielle), on retombe sur la
// fiche paie (brut contractuel × % de base). Le brut retenu est le plus élevé
// des deux, de sorte qu'un éventuel complément contractuel au-dessus de la base
// reste préservé.
function resolveBaseGross(p: { grossContractual: unknown; basePct: unknown }, confBase: number | null): { base: number; gross: number } {
  const grossContract = num(p.grossContractual);
  const base = confBase != null ? confBase : Math.round(grossContract * num(p.basePct));
  return { base, gross: Math.max(grossContract, base) };
}

async function resolvePayslip(
  employeeId: string,
  period: string,
  // Retenue d'absence SAISIE PAR LE RH lors de l'intégration de la paie.
  // Le cahier de présence (module Présences) n'est qu'un TÉMOIN indicatif : il
  // n'alimente jamais automatiquement le calcul (règle métier, 07/08/2026).
  manualRetenue = 0,
  // Retenues internes du mois saisies par le RH (prêts, avances, retards, autres) :
  // elles réduisent le NET (pas le brut ni l'assiette d'impôt).
  internal: { avance: number; pret: number; retard: number; autres: number } = { avance: 0, pret: 0, retard: 0, autres: 0 },
): Promise<
  | { employee: { id: string }; employeeName: string; profile: { matricule: string | null; email: string | null }; rateEffectiveFrom: string; rates: ReturnType<typeof rateDisplay>; payslip: Payslip; attendanceWitness: number }
  | { error: { code: string; message: string }; status: number }
> {
  const [y, m] = period.split("-").map(Number);
  const toDate = new Date(Date.UTC(y, m, 0));
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null }, select: { id: true, firstName: true, lastName: true } });
  if (!employee) return { error: { code: "not_found", message: "Employé introuvable." }, status: 404 };
  const profile = await prisma.payrollEmployeeProfile.findUnique({ where: { employeeId } });
  if (!profile) return { error: { code: "no_profile", message: "Aucune fiche paie pour cet employé : renseignez-la d'abord." }, status: 409 };
  const rateSet = await prisma.payrollRateSet.findFirst({ where: { active: true, effectiveFrom: { lte: toDate } }, orderBy: { effectiveFrom: "desc" } });
  if (!rateSet) return { error: { code: "no_rate_set", message: "Aucun barème de paie en vigueur pour la période." }, status: 409 };

  // Témoin indicatif du cahier de présence (affiché au RH, JAMAIS appliqué au calcul).
  let attendanceWitness = 0;
  const consolidation = await prisma.attendancePayrollPeriod.findUnique({ where: { periodKey: period }, select: { id: true } });
  if (consolidation) {
    const line = await prisma.attendancePayrollLine.findUnique({ where: { periodId_employeeId: { periodId: consolidation.id, employeeId } }, select: { deductionProposed: true } });
    if (line) attendanceWitness = num(line.deductionProposed);
  }

  const confidential = await prisma.employeeConfidential.findUnique({ where: { employeeId }, select: { baseSalary: true } });
  const confBase = confidential?.baseSalary != null ? num(confidential.baseSalary) : null;
  const { base, gross } = resolveBaseGross(profile, confBase);

  // SOURCE UNIQUE DE VÉRITÉ (correction critique) : si une paie du mois existe
  // déjà (ligne du run pour cette période), le BULLETIN est calculé EXACTEMENT
  // comme la grille, la soumission et la clôture — via computeMonthlyLine, qui
  // applique TOUTES les données de la période : primes, heures sup, retenues
  // (absence, avance, prêt, retard, sanction, autres) et lignes libres. La fiche
  // de paie, la génération, la soumission pour clôture et la clôture affichent
  // donc le MÊME net (règle §11). Les retenues passées en paramètres ne servent
  // plus qu'à la PRÉVISUALISATION d'un mois PAS ENCORE PRÉPARÉ (aucune ligne),
  // évitant qu'un bulletin ignore les retenues réellement enregistrées.
  const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period }, select: { id: true } });
  const line = run ? await prisma.payrollMonthlyLine.findUnique({ where: { runId_employeeId: { runId: run.id, employeeId } } }) : null;
  const formulas = await loadFormulaOverlay();
  const payslip: Payslip = line
    ? computeMonthlyLine(profile, ratesFrom(rateSet), line, confBase, formulas, await activeRubriqueMap())
    : computePayslip(
        {
          base,
          complements: Math.round(gross - base),
          fiscalBase: profile.fiscalBase != null ? num(profile.fiscalBase) : gross,
          fiscalParts: num(profile.fiscalParts),
          applyFiscalParts: profile.applyFiscalParts,
          seniorityYears: profile.seniorityYears,
          seniorityRate: profile.seniorityRate != null ? num(profile.seniorityRate) : null,
          seniorityThreshold: profile.seniorityThreshold ?? 0,
          applySeniority: profile.applySeniority,
          retenueAbsence: Math.max(manualRetenue, 0),
          internal: {
            avance: Math.max(internal.avance, 0),
            pret: Math.max(internal.pret, 0),
            retard: Math.max(internal.retard, 0),
            autres: Math.max(internal.autres, 0),
          },
        },
        ratesFrom(rateSet),
        formulas,
      );
  return {
    employee: { id: employee.id },
    employeeName: `${employee.firstName} ${employee.lastName}`,
    profile: { matricule: profile.matricule, email: profile.email },
    rateEffectiveFrom: rateSet.effectiveFrom.toISOString().slice(0, 10),
    rates: rateDisplay(rateSet as unknown as Record<string, unknown>),
    payslip,
    attendanceWitness,
  };
}

// Taux d'affichage du bulletin (colonne « Taux » du modèle moteur) : fractions
// des cotisations, pour reproduire « 4,2 % / 4,2 % », « — / 7 % », « + 10% CAC ».
function rateDisplay(r: Record<string, unknown>) {
  return {
    vid_sal: num(r.vidSalPct), vid_pat: num(r.vidPatPct), pf: num(r.pfPct), at: num(r.atPct),
    cfc_sal: num(r.cfcSalPct), cfc_pat: num(r.cfcPatPct), fne: num(r.fnePct), cac: num(r.cacPct),
    // Barème des avantages en nature (fractions du brut taxable), pour l'évaluation
    // automatique des lignes « avantage en nature » saisies sur la grille.
    avantages_nature: {
      logement: num(r.anLogementPct), electricite: num(r.anElectricitePct), eau: num(r.anEauPct),
      domestique: num(r.anDomestiquePct), vehicule: num(r.anVehiculePct), nourriture: num(r.anNourriturePct),
    },
  };
}

// Barème Prisma → taux du moteur de calcul.
function ratesFrom(r: Record<string, unknown>): PayrollRates {
  return {
    vidSal: num(r.vidSalPct), vidPat: num(r.vidPatPct), pf: num(r.pfPct), at: num(r.atPct), cnpsCeiling: num(r.cnpsCeiling),
    coefAssiette: num(r.coefAssiette), abatPct: num(r.abatPct), abatFixe: num(r.abatFixe), cacPct: num(r.cacPct),
    cfcSal: num(r.cfcSalPct), cfcPat: num(r.cfcPatPct), fne: num(r.fnePct), ancDefPct: num(r.ancDefPct),
    irpp: { p1: num(r.irppT1Ceiling), t1: num(r.irppT1Pct), p2: num(r.irppT2Ceiling), t2: num(r.irppT2Pct), p3: num(r.irppT3Ceiling), t3: num(r.irppT3Pct), t4: num(r.irppT4Pct) },
    tcRav: { seuil1: num(r.tcRavSeuil1), tc1: num(r.tc1), rav1: num(r.rav1), seuil2: num(r.tcRavSeuil2), tc2: num(r.tc2), rav2: num(r.rav2), tc3: num(r.tc3), rav3: num(r.rav3) },
    avantagesNature: {
      logement: num(r.anLogementPct), electricite: num(r.anElectricitePct), eau: num(r.anEauPct),
      domestique: num(r.anDomestiquePct), vehicule: num(r.anVehiculePct), nourriture: num(r.anNourriturePct),
    },
  };
}

// Éléments variables d'une ligne mensuelle → objet plat (API).
// Contrôle d'anomalies d'un mois de paie (§18) — BLOQUANTES (empêchent la
// soumission au DG) ou signalées (n'empêchent pas). Utilise le MÊME moteur que
// les bulletins (aucun calcul parallèle).
type PayrollAnomaly = { employee_id: string | null; employee_name: string; message: string };
async function computeAnomalies(period: string): Promise<{ blocking: PayrollAnomaly[]; warnings: PayrollAnomaly[] }> {
  const blocking: PayrollAnomaly[] = [];
  const warnings: PayrollAnomaly[] = [];
  const [y, m] = period.split("-").map(Number);
  const toDate = new Date(Date.UTC(y, m, 0));
  const rateSet = await prisma.payrollRateSet.findFirst({ where: { active: true, effectiveFrom: { lte: toDate } }, orderBy: { effectiveFrom: "desc" } });
  if (!rateSet) {
    blocking.push({ employee_id: null, employee_name: "—", message: "Aucun barème de paie en vigueur pour la période." });
    return { blocking, warnings };
  }
  const rates = ratesFrom(rateSet as unknown as Record<string, unknown>);
  const formulas = await loadFormulaOverlay();

  // Salariés actifs sans fiche paie : ils ne figureront pas dans la paie du mois.
  const noProfile = await prisma.employee.findMany({ where: { deletedAt: null, status: "salarie", payrollProfile: { is: null } }, select: { id: true, firstName: true, lastName: true } });
  for (const e of noProfile) warnings.push({ employee_id: e.id, employee_name: `${e.firstName} ${e.lastName}`, message: "Aucune fiche paie : ce salarié ne figure pas dans la paie du mois." });

  const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period } });
  if (!run) return { blocking, warnings };
  const lines = await prisma.payrollMonthlyLine.findMany({
    where: { runId: run.id },
    include: { employee: { select: { firstName: true, lastName: true, payrollProfile: true, confidential: { select: { baseSalary: true } } } } },
  });
  const rubriques = await activeRubriqueMap();
  for (const l of lines) {
    const p = l.employee.payrollProfile;
    const name = `${l.employee.firstName} ${l.employee.lastName}`;
    if (!p) {
      blocking.push({ employee_id: l.employeeId, employee_name: name, message: "Fiche paie manquante." });
      continue;
    }
    const confBase = l.employee.confidential?.baseSalary != null ? num(l.employee.confidential.baseSalary) : null;
    const { base } = resolveBaseGross(p, confBase);
    if (base <= 0) blocking.push({ employee_id: l.employeeId, employee_name: name, message: "Salaire de base manquant ou nul : renseignez-le (bloc confidentiel ou fiche paie)." });
    const slip = computeMonthlyLine(p, rates, l, confBase, formulas, rubriques);
    if (slip.net_a_payer < 0) blocking.push({ employee_id: l.employeeId, employee_name: name, message: `Net à payer négatif (${Math.round(slip.net_a_payer).toLocaleString("fr-FR")} FCFA) : les retenues dépassent le salaire.` });
    if (!p.cnpsNumber) warnings.push({ employee_id: l.employeeId, employee_name: name, message: "N° CNPS non renseigné (requis pour la déclaration CNPS)." });
    if (!p.niu) warnings.push({ employee_id: l.employeeId, employee_name: name, message: "NIU non renseigné (requis pour la déclaration fiscale)." });
    if (!p.matricule) warnings.push({ employee_id: l.employeeId, employee_name: name, message: "Matricule non renseigné." });
  }
  return { blocking, warnings };
}

function monthlyElements(l: PayrollMonthlyLine) {
  return {
    primes: num(l.primes), heures_sup: num(l.heuresSup), retenue_absence: num(l.retenueAbsence),
    retard: num(l.retard), avance: num(l.avance), pret: num(l.pret), sanction: num(l.sanction), autres: num(l.autres),
  };
}

// Bulletin d'un salarié pour le mois = fiche paie (barème) + éléments variables.
// Imposables (primes, heures sup) → ajoutés au brut ET à l'assiette. Avant impôt :
// retenue d'absence. Retenues nettes internes : retard, avance, prêt, sanction,
// autres. (Formules ajustables ensuite par l'opérateur.)
// Fige le salaire de la PÉRIODE pour des salariés : renvoie, par employé, le
// salaire de base et le brut contractuel à ENREGISTRER SUR LA LIGNE du mois
// (instantané de la fiche au moment de la préparation / saisie). Chaque mois
// devient ainsi indépendant.
// Champs de PRISMA à écrire sur une nouvelle ligne pour figer l'assiette de la
// période (photographie de la fiche au moment de la préparation / ajout).
type FrozenBasisFields = {
  baseSalary: number; grossContractual: number; fiscalBase: number | null; fiscalParts: number;
  applyFiscalParts: boolean; seniorityYears: number; seniorityRate: number | null; seniorityThreshold: number; applySeniority: boolean;
};
async function periodBaseSnapshot(employeeIds: string[]): Promise<Map<string, FrozenBasisFields>> {
  const ids = [...new Set(employeeIds)];
  if (ids.length === 0) return new Map();
  const [profiles, confs] = await Promise.all([
    prisma.payrollEmployeeProfile.findMany({ where: { employeeId: { in: ids } } }),
    prisma.employeeConfidential.findMany({ where: { employeeId: { in: ids } }, select: { employeeId: true, baseSalary: true } }),
  ]);
  const confMap = new Map(confs.map((c) => [c.employeeId, c.baseSalary != null ? num(c.baseSalary) : null]));
  const map = new Map<string, FrozenBasisFields>();
  for (const p of profiles) {
    const { base, gross } = resolveBaseGross(p, confMap.get(p.employeeId) ?? null);
    map.set(p.employeeId, {
      baseSalary: base,
      grossContractual: gross,
      fiscalBase: p.fiscalBase != null ? num(p.fiscalBase) : null,
      fiscalParts: num(p.fiscalParts),
      applyFiscalParts: p.applyFiscalParts,
      seniorityYears: p.seniorityYears,
      seniorityRate: p.seniorityRate != null ? num(p.seniorityRate) : null,
      seniorityThreshold: p.seniorityThreshold ?? 0,
      applySeniority: p.applySeniority,
    });
  }
  return map;
}

// Assiette de calcul d'un mois : PHOTOGRAPHIE de la période figée sur la ligne
// (isolation stricte D-070). Si la ligne porte l'assiette figée (baseSalary non
// nul), on l'utilise INTÉGRALEMENT — la fiche du salarié ne pilote plus le
// calcul d'un mois déjà préparé. Chaque champ non figé (null, lignes anciennes)
// retombe individuellement sur la fiche. Une ligne SANS base figée (héritée) suit
// encore la fiche (compatibilité), jusqu'à sa prochaine préparation/saisie.
export interface PeriodBasis {
  base: number; gross: number; fiscalBase: number; fiscalParts: number; applyFiscalParts: boolean;
  seniorityYears: number; seniorityRate: number | null; seniorityThreshold: number; applySeniority: boolean;
}
function resolveLineBasis(
  p: { grossContractual: unknown; basePct: unknown; fiscalBase: unknown; fiscalParts: unknown; applyFiscalParts: boolean; seniorityYears: number; seniorityRate: unknown; seniorityThreshold: number | null; applySeniority: boolean },
  l: { baseSalary: unknown; grossContractual: unknown; fiscalBase: unknown; fiscalParts: unknown; applyFiscalParts: boolean | null; seniorityYears: number | null; seniorityRate: unknown; seniorityThreshold: number | null; applySeniority: boolean | null },
  confBase: number | null,
): PeriodBasis {
  const fromProfile = resolveBaseGross(p, confBase);
  const frozen = l.baseSalary != null; // ligne préparée après le correctif période
  const base = frozen ? num(l.baseSalary) : fromProfile.base;
  const gross = frozen ? (l.grossContractual != null ? num(l.grossContractual) : base) : fromProfile.gross;
  const pick = <T>(lineVal: T | null | undefined, profVal: T): T => (frozen && lineVal != null ? lineVal : profVal);
  return {
    base,
    gross,
    fiscalBase: frozen
      ? (l.fiscalBase != null ? num(l.fiscalBase) : (p.fiscalBase != null ? num(p.fiscalBase) : gross))
      : (p.fiscalBase != null ? num(p.fiscalBase) : gross),
    fiscalParts: frozen && l.fiscalParts != null ? num(l.fiscalParts) : num(p.fiscalParts),
    applyFiscalParts: pick(l.applyFiscalParts, p.applyFiscalParts),
    seniorityYears: pick(l.seniorityYears, p.seniorityYears),
    seniorityRate: frozen && l.seniorityRate != null ? num(l.seniorityRate) : (p.seniorityRate != null ? num(p.seniorityRate) : null),
    seniorityThreshold: pick(l.seniorityThreshold, p.seniorityThreshold ?? 0),
    applySeniority: pick(l.applySeniority, p.applySeniority),
  };
}

function computeMonthlyLine(p: PayrollEmployeeProfile, rates: PayrollRates, l: PayrollMonthlyLine, confBase: number | null = null, formulas?: FormulaOverlay, rubriques?: Map<string, RubriqueInfo>): Payslip {
  // ISOLATION STRICTE (D-070) : le salaire de base/brut ET toute l'assiette
  // fiscale/ancienneté proviennent de la PHOTOGRAPHIE figée sur la ligne du mois
  // (resolveLineBasis). Une modification ultérieure de la fiche du salarié — ou
  // d'un autre mois — ne recalcule donc JAMAIS un mois déjà préparé. Les lignes
  // anciennes (sans base figée) retombent sur la fiche (compatibilité).
  const basis = resolveLineBasis(p, l, confBase);
  // Lignes libres : les typées (rubrique active) suivent leur traitement légal,
  // les autres restent gain imposable+cotisable / retenue nette (historique).
  const { rubriqueBrut, rubriqueTaxable, rubriqueCotisable, extraGains, extraRetenues, avantageNatureTaxablePct, avantageNatureCotisablePct } = splitExtraLines(parseExtraLines(l.extraLines), rubriques, rates.avantagesNature);
  const extraTaxable = num(l.primes) + num(l.heuresSup) + extraGains;
  return computePayslip(
    {
      base: basis.base,
      complements: Math.round(basis.gross - basis.base) + extraTaxable,
      fiscalBase: basis.fiscalBase + extraTaxable,
      fiscalParts: basis.fiscalParts,
      applyFiscalParts: basis.applyFiscalParts,
      seniorityYears: basis.seniorityYears,
      seniorityRate: basis.seniorityRate,
      seniorityThreshold: basis.seniorityThreshold,
      applySeniority: basis.applySeniority,
      retenueAbsence: num(l.retenueAbsence),
      internal: { avance: num(l.avance), pret: num(l.pret), retard: num(l.retard), autres: num(l.autres) + num(l.sanction) + extraRetenues },
      rubriqueBrut, rubriqueTaxable, rubriqueCotisable,
      avantageNatureTaxablePct, avantageNatureCotisablePct,
    },
    rates,
    formulas,
  );
}

const profileSchema = z.object({
  matricule: z.string().max(40).optional(),
  email: z.string().email().nullable().optional().or(z.literal("")),
  cnps_number: z.string().max(40).optional(),
  niu: z.string().max(40).optional(),
  category: z.string().max(60).optional(),
  payment_mode: z.string().max(60).optional(),
  account_number: z.string().max(60).optional(),
  gross_contractual: z.number().min(0),
  base_pct: z.number().min(0).max(1),
  fiscal_base: z.number().min(0).nullable().optional(),
  fiscal_parts: z.number().min(0.5).max(20),
  apply_fiscal_parts: z.boolean(),
  seniority_years: z.number().int().min(0),
  seniority_rate: z.number().min(0).max(1).nullable().optional(),
  seniority_threshold: z.number().int().min(0).nullable().optional(),
  apply_seniority: z.boolean(),
  // Motif de modification d'une fiche déjà enregistrée (tracé au journal). Vide
  // à la première saisie ; renseigné quand on rouvre une fiche pour la corriger.
  modification_reason: z.string().max(2000).optional(),
});

function profileView(p: {
  matricule: string | null;
  email: string | null;
  cnpsNumber: string | null;
  niu: string | null;
  category: string | null;
  paymentMode: string | null;
  accountNumber: string | null;
  grossContractual: unknown;
  basePct: unknown;
  fiscalBase: unknown;
  fiscalParts: unknown;
  applyFiscalParts: boolean;
  seniorityYears: number;
  seniorityRate: unknown;
  seniorityThreshold: number | null;
  applySeniority: boolean;
}) {
  const gross = num(p.grossContractual);
  const basePct = num(p.basePct);
  const base = Math.round(gross * basePct);
  return {
    matricule: p.matricule,
    email: p.email,
    cnps_number: p.cnpsNumber,
    niu: p.niu,
    category: p.category,
    payment_mode: p.paymentMode,
    account_number: p.accountNumber,
    gross_contractual: gross,
    base_pct: basePct,
    // Dérivés (indicatifs) : salaire de base et compléments.
    base_salary: base,
    complements: Math.round(gross - base),
    fiscal_base: p.fiscalBase != null ? num(p.fiscalBase) : null,
    fiscal_parts: num(p.fiscalParts),
    apply_fiscal_parts: p.applyFiscalParts,
    seniority_years: p.seniorityYears,
    seniority_rate: p.seniorityRate != null ? num(p.seniorityRate) : null,
    seniority_threshold: p.seniorityThreshold,
    apply_seniority: p.applySeniority,
  };
}

// Livre de paie d'une période : calcul par lot (barème + consolidation Présences
// chargés une seule fois) de tous les salariés dotés d'une fiche paie.
async function computeRegister(period: string): Promise<
  | { period: string; rate_effective_from: string; lines: RegisterLine[]; totals: { brut: number; net: number; charges_pat: number }; monthly_status: "brouillon" | "soumis_dg" | "valide" | null }
  | { error: { code: string; message: string }; status: number }
> {
  const [y, m] = period.split("-").map(Number);
  const toDate = new Date(Date.UTC(y, m, 0));
  const rateSet = await prisma.payrollRateSet.findFirst({ where: { active: true, effectiveFrom: { lte: toDate } }, orderBy: { effectiveFrom: "desc" } });
  if (!rateSet) return { error: { code: "no_rate_set", message: "Aucun barème de paie en vigueur pour la période." }, status: 409 };
  const rates = ratesFrom(rateSet as unknown as Record<string, unknown>);
  const formulas = await loadFormulaOverlay();

  // CORRECTION (D-041) : le livre de paie d'une période ne contient QUE les
  // salariés dont une paie a été RÉELLEMENT créée pour cette période — c.-à-d.
  // une ligne dans le run du mois (mois préparé). Il n'y a AUCUN repli sur la
  // fiche permanente : la seule présence d'un salarié dans la base RH ne fait
  // plus apparaître sa paie dans tous les mois. Un mois non préparé (aucun run)
  // n'a donc aucune ligne — rien n'est généré automatiquement pour les mois
  // futurs. Chaque fiche de paie = (employé + période).
  const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period } });
  const rubriques = await activeRubriqueMap();
  const lines: RegisterLine[] = [];
  const totals = { brut: 0, net: 0, charges_pat: 0 };
  // CORRECTION (D-044) : la ROSTER d'un mois = les lignes réellement créées pour
  // ce mois (le run), sans AUCUN filtre secondaire sur le salarié. On ne filtre
  // PLUS sur `employee.deletedAt` : une fiche de paie enregistrée pour août
  // appartient à août même si le salarié a quitté l'entreprise depuis (sinon un
  // salarié parti — donc archivé/supprimé logiquement — disparaissait de la
  // clôture de son propre mois, alors qu'il apparaissait toujours dans la grille
  // de saisie qui, elle, ne filtrait pas). La grille (saisie) et le livre de paie
  // (clôture) listent désormais exactement le même ensemble : toutes les lignes
  // du mois. Le journal figé archive donc bien tous les bulletins du mois.
  const monthLines = run
    ? await prisma.payrollMonthlyLine.findMany({
        where: { runId: run.id },
        include: { employee: { select: { firstName: true, lastName: true, niu: true, payrollProfile: true, confidential: { select: { baseSalary: true } } } } },
      })
    : [];
  for (const l of monthLines) {
    const p = l.employee.payrollProfile;
    if (!p) continue; // sans fiche paie, aucun calcul possible → non listé
    const confBase = l.employee.confidential?.baseSalary != null ? num(l.employee.confidential.baseSalary) : null;
    const ps = computeMonthlyLine(p, rates, l, confBase, formulas, rubriques);
    lines.push({
      employee_id: l.employeeId,
      employee_name: `${l.employee.firstName} ${l.employee.lastName}`,
      matricule: p.matricule,
      cnps_number: p.cnpsNumber,
      niu: l.employee.niu ?? p.niu,
      salaire_brut: ps.salaire_brut,
      salaire_taxable: ps.assiette_fiscale,
      cnps_cotisable_total: ps.cnps_cotisable_total,
      assiette_cnps: ps.assiette_cnps,
      irpp: ps.irpp,
      pvid_salarie: ps.pvid_salarie,
      pvid_patronal: ps.pvid_patronal,
      prestations_familiales: ps.prestations_familiales,
      accidents_travail: ps.accidents_travail,
      cfc_salarie: ps.cfc_salarie,
      cfc_patronal: ps.cfc_patronal,
      fne: ps.fne,
      taxe_communale: ps.taxe_communale,
      rav: ps.rav,
      irpp_cac: ps.irpp_cac,
      total_retenues_salariales: ps.total_retenues_salariales,
      total_charges_patronales: ps.total_charges_patronales,
      net_a_payer: ps.net_a_payer,
      cout_employeur: ps.cout_employeur,
    });
    totals.brut += ps.salaire_brut;
    totals.net += ps.net_a_payer;
    totals.charges_pat += ps.total_charges_patronales;
  }
  lines.sort((a, b) => a.employee_name.localeCompare(b.employee_name, "fr"));
  return { period, rate_effective_from: rateSet.effectiveFrom.toISOString().slice(0, 10), lines, totals, monthly_status: run?.status ?? null };
}

interface RegisterLine {
  employee_id: string;
  employee_name: string;
  matricule: string | null;
  cnps_number: string | null;
  niu: string | null;
  salaire_brut: number;
  salaire_taxable: number;
  cnps_cotisable_total: number;
  assiette_cnps: number;
  irpp: number;
  pvid_salarie: number;
  pvid_patronal: number;
  prestations_familiales: number;
  accidents_travail: number;
  cfc_salarie: number;
  cfc_patronal: number;
  fne: number;
  taxe_communale: number;
  rav: number;
  irpp_cac: number;
  total_retenues_salariales: number;
  total_charges_patronales: number;
  net_a_payer: number;
  cout_employeur: number;
}

function journalLineView(l: Record<string, unknown> & { employeeId: string; employeeName: string; matricule: string | null; cnpsNumber: string | null; niu: string | null }) {
  return {
    employee_id: l.employeeId,
    employee_name: l.employeeName,
    matricule: l.matricule,
    cnps_number: l.cnpsNumber,
    niu: l.niu,
    salaire_brut: num(l.salaireBrut),
    assiette_cnps: num(l.assietteCnps),
    pvid_salarie: num(l.pvidSalarie),
    pvid_patronal: num(l.pvidPatronal),
    prestations_familiales: num(l.prestationsFamiliales),
    accidents_travail: num(l.accidentsTravail),
    cfc_salarie: num(l.cfcSalarie),
    cfc_patronal: num(l.cfcPatronal),
    fne: num(l.fne),
    taxe_communale: num(l.taxeCommunale),
    rav: num(l.rav),
    irpp_cac: num(l.irppCac),
    total_retenues_salariales: num(l.totalRetenuesSalariales),
    total_charges_patronales: num(l.totalChargesPatronales),
    net_a_payer: num(l.netAPayer),
    cout_employeur: num(l.coutEmployeur),
  };
}
