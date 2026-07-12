import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { computePayslip, type PayrollRates } from "../lib/payrollEngine.js";

// Module « Paie » natif (D-007) — incrément 1 : barème légal camerounais
// PARAMÉTRABLE et VERSIONNÉ, et interrupteur d'internalisation (oui/non).
// Réimplémentation du moteur Excel (docs/paie/). Permissions : module `paie`.

const num = (v: unknown): number => (v == null ? 0 : Number(v));

function rateSetView(r: Record<string, unknown> & { id: string; effectiveFrom: Date; label: string | null; active: boolean }) {
  return {
    id: r.id,
    effective_from: (r.effectiveFrom as Date).toISOString().slice(0, 10),
    label: r.label,
    active: r.active,
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
  cnps: z.object({ vid_sal_pct: pct, vid_pat_pct: pct, pf_pct: pct, at_pct: pct, ceiling: money }),
  fiscal: z.object({ abat_pct: pct, abat_fixe: money, cac_pct: pct, cfc_sal_pct: pct, cfc_pat_pct: pct, fne_pct: pct }),
  misc: z.object({ coef_assiette: pct, heures_mois: z.number().positive(), anc_def_pct: pct }),
  irpp: z.object({ t1_ceiling: money, t1_pct: pct, t2_ceiling: money, t2_pct: pct, t3_ceiling: money, t3_pct: pct, t4_pct: pct }),
  tc_rav: z.object({ seuil1: money, tc1: money, rav1: money, seuil2: money, tc2: money, rav2: money, tc3: money, rav3: money }),
});

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
          vidSalPct: b.cnps.vid_sal_pct, vidPatPct: b.cnps.vid_pat_pct, pfPct: b.cnps.pf_pct, atPct: b.cnps.at_pct, cnpsCeiling: b.cnps.ceiling,
          abatPct: b.fiscal.abat_pct, abatFixe: b.fiscal.abat_fixe, cacPct: b.fiscal.cac_pct, cfcSalPct: b.fiscal.cfc_sal_pct, cfcPatPct: b.fiscal.cfc_pat_pct, fnePct: b.fiscal.fne_pct,
          coefAssiette: b.misc.coef_assiette, heuresMois: b.misc.heures_mois, ancDefPct: b.misc.anc_def_pct,
          irppT1Ceiling: b.irpp.t1_ceiling, irppT1Pct: b.irpp.t1_pct, irppT2Ceiling: b.irpp.t2_ceiling, irppT2Pct: b.irpp.t2_pct, irppT3Ceiling: b.irpp.t3_ceiling, irppT3Pct: b.irpp.t3_pct, irppT4Pct: b.irpp.t4_pct,
          tcRavSeuil1: b.tc_rav.seuil1, tc1: b.tc_rav.tc1, rav1: b.tc_rav.rav1, tcRavSeuil2: b.tc_rav.seuil2, tc2: b.tc_rav.tc2, rav2: b.tc_rav.rav2, tc3: b.tc_rav.tc3, rav3: b.tc_rav.rav3,
          createdBy: request.user!.id,
        },
      });
      await writeAuditLog({ userId: request.user!.id, action: "create", entityType: "payroll_rate_set", entityId: created.id, newValues: { effective_from: b.effective_from, label: b.label ?? null }, ipAddress: request.ip });
      return reply.code(201).send(rateSetView(created));
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
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "payroll_employee_profile", entityId: employeeId, newValues: { gross_contractual: b.gross_contractual, base_pct: b.base_pct }, ipAddress: request.ip });
      return reply.send(profileView(saved));
    },
  );

  // ----- Calcul du bulletin (incrément 3) : brut → net -----------------------
  fastify.get(
    "/api/v1/payroll/employees/:employeeId/payslip",
    { preHandler: requirePermission("paie", "consultation") },
    async (request, reply) => {
      const { employeeId } = request.params as { employeeId: string };
      const query = request.query as { period?: string };
      const period = query.period && /^\d{4}-\d{2}$/.test(query.period) ? query.period : new Date().toISOString().slice(0, 7);
      const [y, m] = period.split("-").map(Number);
      const toDate = new Date(Date.UTC(y, m, 0)); // dernier jour du mois

      const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null }, select: { id: true, firstName: true, lastName: true } });
      if (!employee) return reply.code(404).send({ code: "not_found", message: "Employé introuvable." });
      const profile = await prisma.payrollEmployeeProfile.findUnique({ where: { employeeId } });
      if (!profile) return reply.code(409).send({ code: "no_profile", message: "Aucune fiche paie pour cet employé : renseignez-la d'abord." });
      const rateSet = await prisma.payrollRateSet.findFirst({ where: { active: true, effectiveFrom: { lte: toDate } }, orderBy: { effectiveFrom: "desc" } });
      if (!rateSet) return reply.code(409).send({ code: "no_rate_set", message: "Aucun barème de paie en vigueur pour la période." });

      // Retenue d'absence issue du module Présences (consolidation de la période).
      let retenueAbsence = 0;
      const consolidation = await prisma.attendancePayrollPeriod.findUnique({ where: { periodKey: period }, select: { id: true } });
      if (consolidation) {
        const line = await prisma.attendancePayrollLine.findUnique({ where: { periodId_employeeId: { periodId: consolidation.id, employeeId } }, select: { deductionProposed: true } });
        if (line) retenueAbsence = num(line.deductionProposed);
      }

      const gross = num(profile.grossContractual);
      const base = Math.round(gross * num(profile.basePct));
      const complements = Math.round(gross - base);
      const payslip = computePayslip(
        {
          base,
          complements,
          fiscalBase: profile.fiscalBase != null ? num(profile.fiscalBase) : gross,
          fiscalParts: num(profile.fiscalParts),
          applyFiscalParts: profile.applyFiscalParts,
          seniorityYears: profile.seniorityYears,
          seniorityRate: profile.seniorityRate != null ? num(profile.seniorityRate) : null,
          seniorityThreshold: profile.seniorityThreshold ?? 0,
          applySeniority: profile.applySeniority,
          retenueAbsence,
          internal: { avance: 0, pret: 0, retard: 0, autres: 0 },
        },
        ratesFrom(rateSet),
      );

      await writeAuditLog({ userId: request.user!.id, action: "view_sensitive", entityType: "payslip", entityId: `${employeeId}:${period}`, ipAddress: request.ip });
      return reply.send({
        employee: { id: employee.id, name: `${employee.firstName} ${employee.lastName}` },
        period,
        rate_set_effective_from: rateSet.effectiveFrom.toISOString().slice(0, 10),
        payslip,
      });
    },
  );
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

const profileSchema = z.object({
  matricule: z.string().max(40).optional(),
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
});

function profileView(p: {
  matricule: string | null;
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
