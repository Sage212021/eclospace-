import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { computePayslip, type Payslip, type PayrollRates, type FormulaOverlay } from "../lib/payrollEngine.js";
import { evaluateExpression, FormulaError, FORMULA_BY_CODE, FORMULA_CODES } from "../lib/payrollFormula.js";
import type { PayrollEmployeeProfile, PayrollMonthlyLine } from "@prisma/client";
import { buildPayslipEmail } from "../lib/documentEmail.js";
import { sendMail, senderIdentity } from "../lib/mailer.js";

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
  primes: money, heures_sup: money, retenue_absence: money,
  retard: money, avance: money, pret: money, sanction: money, autres: money,
  // Lignes libres ajoutées par le RH (aucune codée en dur) : gains imposables
  // ou retenues nettes, avec un libellé et un montant.
  extra_lines: z.array(z.object({ label: z.string().min(1).max(80), kind: z.enum(["gain", "retenue"]), amount: money })).max(30).optional(),
  note: z.string().max(500).nullable().optional(),
});

type ExtraLine = { label: string; kind: "gain" | "retenue"; amount: number };
function parseExtraLines(v: unknown): ExtraLine[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      if (typeof o.label === "string" && (o.kind === "gain" || o.kind === "retenue") && typeof o.amount === "number") {
        return [{ label: o.label, kind: o.kind, amount: Math.max(o.amount, 0) }];
      }
    }
    return [];
  });
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
          createdBy: request.user!.id,
        },
      });
      await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "payroll_rate_set", entityId: created.id, newValues: { effective_from: b.effective_from, label: b.label ?? null, change_reason: b.change_reason ?? null }, ipAddress: request.ip });
      return reply.code(201).send(rateSetView(created));
    },
  );

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
      });
    },
  );

  fastify.put(
    "/api/v1/payroll/employees/:employeeId/deductions",
    { preHandler: requirePermission("paie", "saisie") },
    async (request, reply) => {
      const { employeeId } = request.params as { employeeId: string };
      const parsed = z
        .object({
          period: z.string(),
          primes: money.default(0),
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
          await prisma.payrollMonthlyLine.createMany({ data: profiles.map((p) => ({ runId: run!.id, employeeId: p.employeeId })), skipDuplicates: true });
        }
      }
      // La ligne du salarié peut manquer (salarié sans fiche paie / ajouté après) :
      // on la crée à la volée.
      // On n'écrit QUE les éléments gérés par le bulletin unitaire (gains + retenues) ;
      // sanction, lignes libres et note restent tels quels (gérés dans la grille).
      const elems = {
        primes: parsed.data.primes, heuresSup: parsed.data.heures_sup,
        retenueAbsence: parsed.data.retenue_absence,
        avance: parsed.data.avance, pret: parsed.data.pret, retard: parsed.data.retard, autres: parsed.data.autres,
      };
      await prisma.payrollMonthlyLine.upsert({
        where: { runId_employeeId: { runId: run.id, employeeId } },
        update: elems,
        create: { runId: run.id, employeeId, ...elems },
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
      const closure = await prisma.payrollClosure.findUnique({ where: { periodKey: period }, select: { closedAt: true, closedBy: true } });
      return reply.send({ ...reg, closed: Boolean(closure), closed_at: closure?.closedAt ?? null });
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
        await prisma.payrollMonthlyLine.createMany({ data: toCreate.map((p) => ({ runId: run!.id, employeeId: p.employeeId })) });
      }
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

      // Auto-complétion : un salarié dont la FICHE PAIE a été créée APRÈS la
      // préparation du mois n'avait pas de ligne et restait invisible. Tant que le
      // mois est modifiable (brouillon), on crée à la volée les lignes manquantes
      // pour tous les salariés dotés d'une fiche → ils apparaissent immédiatement.
      if (run.status === "brouillon") {
        const profiles = await prisma.payrollEmployeeProfile.findMany({ where: { employee: { deletedAt: null } }, select: { employeeId: true } });
        const existing = new Set((await prisma.payrollMonthlyLine.findMany({ where: { runId: run.id }, select: { employeeId: true } })).map((l) => l.employeeId));
        const toCreate = profiles.filter((p) => !existing.has(p.employeeId));
        if (toCreate.length > 0) {
          await prisma.payrollMonthlyLine.createMany({ data: toCreate.map((p) => ({ runId: run.id, employeeId: p.employeeId })), skipDuplicates: true });
        }
      }

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

      const rows = lines
        .filter((l) => l.employee.payrollProfile)
        .map((l) => {
          const p = l.employee.payrollProfile!;
          const confBase = l.employee.confidential?.baseSalary != null ? num(l.employee.confidential.baseSalary) : null;
          const slip = computeMonthlyLine(p, rates, l, confBase, formulas);
          return {
            employee_id: l.employeeId,
            employee_name: `${l.employee.firstName} ${l.employee.lastName}`,
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
      // Employés SANS fiche paie : ils n'apparaissent pas dans la grille (le calcul
      // exige une fiche). On les remonte explicitement pour que le RH sache QUI
      // reste à compléter — sinon ils semblent « disparus ».
      const missing = await prisma.employee.findMany({
        where: { deletedAt: null, payrollProfile: { is: null } },
        select: { id: true, firstName: true, lastName: true, department: { select: { name: true } } },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      });
      const missingProfiles = missing.map((e) => ({ employee_id: e.id, name: `${e.firstName} ${e.lastName}`, department: e.department?.name ?? null }));
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
          primes: b.primes, heuresSup: b.heures_sup, retenueAbsence: b.retenue_absence,
          retard: b.retard, avance: b.avance, pret: b.pret, sanction: b.sanction, autres: b.autres,
          extraLines: b.extra_lines ?? [],
          note: b.note,
        },
      });
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
      await prisma.payrollMonthlyRun.update({
        where: { id: run.id },
        data: { status: "brouillon", returnReason: parsed.data.reason, returnedBy: request.user!.id, returnedAt: new Date(), submittedBy: null, submittedAt: null },
      });
      await writeAuditLog({ userId: request.user!.id, action: "status_change", entityType: "payroll_monthly_run", entityId: period, newValues: { status: "brouillon", returned: true, reason: parsed.data.reason }, ipAddress: request.ip });
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
      await prisma.payrollMonthlyRun.update({ where: { id: run.id }, data: { status: "valide", validatedBy: request.user!.id, validatedAt: new Date() } });
      await writeAuditLog({ userId: request.user!.id, action: "validate", entityType: "payroll_monthly_run", entityId: period, ipAddress: request.ip });
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
      const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period } });
      if (!run) return reply.code(404).send({ code: "not_found", message: "Mois non préparé." });
      const closure = await prisma.payrollClosure.findUnique({ where: { periodKey: period }, select: { id: true } });
      if (closure) return reply.code(409).send({ code: "already_closed", message: "Livre de paie clôturé : le mois est définitif et ne peut plus être rouvert." });
      await prisma.payrollMonthlyRun.update({ where: { id: run.id }, data: { status: "brouillon", validatedBy: null, validatedAt: null } });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "payroll_monthly_run", entityId: period, newValues: { reopened: true }, ipAddress: request.ip });
      return reply.send({ period, status: "brouillon" });
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
  const { base, gross } = resolveBaseGross(profile, confidential?.baseSalary != null ? num(confidential.baseSalary) : null);
  const payslip = computePayslip(
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
    await loadFormulaOverlay(),
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
    const slip = computeMonthlyLine(p, rates, l, confBase, formulas);
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
function computeMonthlyLine(p: PayrollEmployeeProfile, rates: PayrollRates, l: PayrollMonthlyLine, confBase: number | null = null, formulas?: FormulaOverlay): Payslip {
  const { base, gross } = resolveBaseGross(p, confBase);
  // Lignes libres : les gains s'ajoutent au brut imposable, les retenues au net.
  const extras = parseExtraLines(l.extraLines);
  const extraGains = extras.filter((e) => e.kind === "gain").reduce((s, e) => s + e.amount, 0);
  const extraRetenues = extras.filter((e) => e.kind === "retenue").reduce((s, e) => s + e.amount, 0);
  const extraTaxable = num(l.primes) + num(l.heuresSup) + extraGains;
  return computePayslip(
    {
      base,
      complements: Math.round(gross - base) + extraTaxable,
      fiscalBase: (p.fiscalBase != null ? num(p.fiscalBase) : gross) + extraTaxable,
      fiscalParts: num(p.fiscalParts),
      applyFiscalParts: p.applyFiscalParts,
      seniorityYears: p.seniorityYears,
      seniorityRate: p.seniorityRate != null ? num(p.seniorityRate) : null,
      seniorityThreshold: p.seniorityThreshold ?? 0,
      applySeniority: p.applySeniority,
      retenueAbsence: num(l.retenueAbsence),
      internal: { avance: num(l.avance), pret: num(l.pret), retard: num(l.retard), autres: num(l.autres) + num(l.sanction) + extraRetenues },
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

  const profiles = await prisma.payrollEmployeeProfile.findMany({
    where: { employee: { deletedAt: null } },
    include: { employee: { select: { id: true, firstName: true, lastName: true, confidential: { select: { baseSalary: true } } } } },
  });

  // Si le mois a été PRÉPARÉ (grille mensuelle), le livre de paie reprend les
  // éléments variables saisis (primes, heures sup, absences, retards, avances,
  // prêts, sanctions) — les mêmes valeurs que les bulletins. Sinon (mois non
  // préparé), calcul depuis les seules fiches paie. La retenue d'absence n'est
  // jamais issue des présences (règle 07/08/2026) : elle est saisie sur la grille.
  const run = await prisma.payrollMonthlyRun.findUnique({ where: { periodKey: period } });
  const lineByEmp = new Map<string, PayrollMonthlyLine>();
  if (run) {
    for (const l of await prisma.payrollMonthlyLine.findMany({ where: { runId: run.id } })) lineByEmp.set(l.employeeId, l);
  }

  const lines: RegisterLine[] = [];
  const totals = { brut: 0, net: 0, charges_pat: 0 };
  for (const p of profiles) {
    const confBase = p.employee.confidential?.baseSalary != null ? num(p.employee.confidential.baseSalary) : null;
    const { base, gross } = resolveBaseGross(p, confBase);
    const monthLine = lineByEmp.get(p.employeeId);
    const ps = monthLine
      ? computeMonthlyLine(p, rates, monthLine, confBase, formulas)
      : computePayslip(
          {
            base,
            complements: Math.round(gross - base),
            fiscalBase: p.fiscalBase != null ? num(p.fiscalBase) : gross,
            fiscalParts: num(p.fiscalParts),
            applyFiscalParts: p.applyFiscalParts,
            seniorityYears: p.seniorityYears,
            seniorityRate: p.seniorityRate != null ? num(p.seniorityRate) : null,
            seniorityThreshold: p.seniorityThreshold ?? 0,
            applySeniority: p.applySeniority,
            retenueAbsence: 0,
            internal: { avance: 0, pret: 0, retard: 0, autres: 0 },
          },
          rates,
          formulas,
        );
    lines.push({
      employee_id: p.employeeId,
      employee_name: `${p.employee.firstName} ${p.employee.lastName}`,
      matricule: p.matricule,
      cnps_number: p.cnpsNumber,
      niu: p.niu,
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
