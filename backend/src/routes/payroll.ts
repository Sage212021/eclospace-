import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { computePayslip, type Payslip, type PayrollRates } from "../lib/payrollEngine.js";
import { buildPayslipEmail } from "../lib/documentEmail.js";
import { sendMail, senderIdentity } from "../lib/mailer.js";

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
      const period = normalizePeriod((request.query as { period?: string }).period);
      const resolved = await resolvePayslip(employeeId, period);
      if ("error" in resolved) return reply.code(resolved.status).send(resolved.error);
      await writeAuditLog({ userId: request.user!.id, action: "view_sensitive", entityType: "payslip", entityId: `${employeeId}:${period}`, ipAddress: request.ip });
      return reply.send({
        employee: { id: resolved.employee.id, name: resolved.employeeName },
        period,
        rate_set_effective_from: resolved.rateEffectiveFrom,
        payslip: resolved.payslip,
      });
    },
  );

  // ----- Envoi du bulletin par e-mail (incrément 4) --------------------------
  fastify.post(
    "/api/v1/payroll/employees/:employeeId/payslip/email",
    { preHandler: requirePermission("paie", "consultation") },
    async (request, reply) => {
      const { employeeId } = request.params as { employeeId: string };
      const parsed = z.object({ period: z.string().optional(), message: z.string().max(2000).optional(), to: z.string().email().optional(), preview: z.boolean().optional() }).safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      const period = normalizePeriod(parsed.data.period);
      const resolved = await resolvePayslip(employeeId, period);
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

      let sent: boolean;
      try {
        const sender = senderIdentity(request.user!);
        sent = await sendMail({ to, subject: built.subject, text: built.text, html: built.html, ...sender });
      } catch (err) {
        if (err instanceof Error && err.message === "mail_not_configured") {
          return reply.code(503).send({ code: "mail_not_configured", message: "L'envoi d'e-mails n'est pas encore configuré (paramètres SMTP à renseigner sur l'hébergement)." });
        }
        throw err;
      }
      await writeAuditLog({ userId: request.user!.id, action: "export", entityType: "payslip_email", entityId: `${employeeId}:${period}`, newValues: { to, sent }, ipAddress: request.ip });
      return reply.send({ sent, to });
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
async function resolvePayslip(
  employeeId: string,
  period: string,
): Promise<
  | { employee: { id: string }; employeeName: string; profile: { matricule: string | null; email: string | null }; rateEffectiveFrom: string; payslip: Payslip }
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

  let retenueAbsence = 0;
  const consolidation = await prisma.attendancePayrollPeriod.findUnique({ where: { periodKey: period }, select: { id: true } });
  if (consolidation) {
    const line = await prisma.attendancePayrollLine.findUnique({ where: { periodId_employeeId: { periodId: consolidation.id, employeeId } }, select: { deductionProposed: true } });
    if (line) retenueAbsence = num(line.deductionProposed);
  }

  const gross = num(profile.grossContractual);
  const base = Math.round(gross * num(profile.basePct));
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
      retenueAbsence,
      internal: { avance: 0, pret: 0, retard: 0, autres: 0 },
    },
    ratesFrom(rateSet),
  );
  return {
    employee: { id: employee.id },
    employeeName: `${employee.firstName} ${employee.lastName}`,
    profile: { matricule: profile.matricule, email: profile.email },
    rateEffectiveFrom: rateSet.effectiveFrom.toISOString().slice(0, 10),
    payslip,
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
  | { period: string; rate_effective_from: string; lines: RegisterLine[]; totals: { brut: number; net: number; charges_pat: number } }
  | { error: { code: string; message: string }; status: number }
> {
  const [y, m] = period.split("-").map(Number);
  const toDate = new Date(Date.UTC(y, m, 0));
  const rateSet = await prisma.payrollRateSet.findFirst({ where: { active: true, effectiveFrom: { lte: toDate } }, orderBy: { effectiveFrom: "desc" } });
  if (!rateSet) return { error: { code: "no_rate_set", message: "Aucun barème de paie en vigueur pour la période." }, status: 409 };
  const rates = ratesFrom(rateSet as unknown as Record<string, unknown>);

  const profiles = await prisma.payrollEmployeeProfile.findMany({
    where: { employee: { deletedAt: null } },
    include: { employee: { select: { id: true, firstName: true, lastName: true } } },
  });

  // Retenues d'absence (module Présences) de la période, chargées en une fois.
  const consolidation = await prisma.attendancePayrollPeriod.findUnique({ where: { periodKey: period }, select: { id: true } });
  const retenueByEmp = new Map<string, number>();
  if (consolidation) {
    const lines = await prisma.attendancePayrollLine.findMany({ where: { periodId: consolidation.id }, select: { employeeId: true, deductionProposed: true } });
    for (const l of lines) retenueByEmp.set(l.employeeId, num(l.deductionProposed));
  }

  const lines: RegisterLine[] = [];
  const totals = { brut: 0, net: 0, charges_pat: 0 };
  for (const p of profiles) {
    const gross = num(p.grossContractual);
    const base = Math.round(gross * num(p.basePct));
    const ps = computePayslip(
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
        retenueAbsence: retenueByEmp.get(p.employeeId) ?? 0,
        internal: { avance: 0, pret: 0, retard: 0, autres: 0 },
      },
      rates,
    );
    lines.push({
      employee_id: p.employeeId,
      employee_name: `${p.employee.firstName} ${p.employee.lastName}`,
      matricule: p.matricule,
      cnps_number: p.cnpsNumber,
      niu: p.niu,
      salaire_brut: ps.salaire_brut,
      assiette_cnps: ps.assiette_cnps,
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
  return { period, rate_effective_from: rateSet.effectiveFrom.toISOString().slice(0, 10), lines, totals };
}

interface RegisterLine {
  employee_id: string;
  employee_name: string;
  matricule: string | null;
  cnps_number: string | null;
  niu: string | null;
  salaire_brut: number;
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
