import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { computePayslip, type Payslip, type PayrollRates } from "../lib/payrollEngine.js";
import type { PayrollEmployeeProfile, PayrollMonthlyLine } from "@prisma/client";
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

// Éléments variables du mois pour un salarié (grille mensuelle).
const monthlyLineSchema = z.object({
  primes: money, heures_sup: money, retenue_absence: money,
  retard: money, avance: money, pret: money, sanction: money, autres: money,
  note: z.string().max(500).nullable().optional(),
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
      const q = request.query as { period?: string; retenue_absence?: string };
      const period = normalizePeriod(q.period);
      // Retenue d'absence saisie par le RH (0 par défaut) — jamais issue des présences.
      const manualRetenue = q.retenue_absence != null ? Math.max(Number(q.retenue_absence) || 0, 0) : 0;
      const resolved = await resolvePayslip(employeeId, period, manualRetenue);
      if ("error" in resolved) return reply.code(resolved.status).send(resolved.error);
      await writeAuditLog({ userId: request.user!.id, action: "view_sensitive", entityType: "payslip", entityId: `${employeeId}:${period}`, ipAddress: request.ip });
      return reply.send({
        employee: { id: resolved.employee.id, name: resolved.employeeName },
        period,
        rate_set_effective_from: resolved.rateEffectiveFrom,
        payslip: resolved.payslip,
        // Témoin indicatif du cahier de présence (n'est pas appliqué au net).
        attendance_witness: resolved.attendanceWitness,
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

      const lines = await prisma.payrollMonthlyLine.findMany({
        where: { runId: run.id },
        include: {
          employee: {
            select: {
              id: true, firstName: true, lastName: true, position: true, hireDate: true, birthDate: true, leaveBalanceDays: true,
              department: { select: { name: true } },
              hrContracts: { orderBy: { startDate: "desc" }, take: 1, select: { type: true } },
              payrollProfile: true,
            },
          },
        },
        orderBy: { employee: { lastName: "asc" } },
      });

      const rows = lines
        .filter((l) => l.employee.payrollProfile)
        .map((l) => {
          const p = l.employee.payrollProfile!;
          const slip = computeMonthlyLine(p, rates, l);
          return {
            employee_id: l.employeeId,
            employee_name: `${l.employee.firstName} ${l.employee.lastName}`,
            matricule: p.matricule,
            cnps_number: p.cnpsNumber,
            niu: p.niu,
            fiscal_parts: num(p.fiscalParts),
            // Informations salarié pour le bulletin (modèle du classeur).
            department: l.employee.department?.name ?? null,
            position: l.employee.position ?? null,
            hire_date: l.employee.hireDate ? l.employee.hireDate.toISOString().slice(0, 10) : null,
            birth_date: l.employee.birthDate ? l.employee.birthDate.toISOString().slice(0, 10) : null,
            contract_type: l.employee.hrContracts[0]?.type ?? null,
            category: p.category,
            email: p.email,
            payment_mode: p.paymentMode,
            account_number: p.accountNumber,
            leave_balance: num(l.employee.leaveBalanceDays),
            elements: monthlyElements(l),
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
      return reply.send({ exists: true, period, status: run.status, validated_at: run.validatedAt, rate_effective_from: rateSet.effectiveFrom.toISOString().slice(0, 10), lines: rows, totals });
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

      const b = parsed.data;
      await prisma.payrollMonthlyLine.update({
        where: { runId_employeeId: { runId: run.id, employeeId } },
        data: {
          primes: b.primes, heuresSup: b.heures_sup, retenueAbsence: b.retenue_absence,
          retard: b.retard, avance: b.avance, pret: b.pret, sanction: b.sanction, autres: b.autres,
          note: b.note,
        },
      });
      return reply.send({ ok: true });
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
  // Retenue d'absence SAISIE PAR LE RH lors de l'intégration de la paie.
  // Le cahier de présence (module Présences) n'est qu'un TÉMOIN indicatif : il
  // n'alimente jamais automatiquement le calcul (règle métier, 07/08/2026).
  manualRetenue = 0,
): Promise<
  | { employee: { id: string }; employeeName: string; profile: { matricule: string | null; email: string | null }; rateEffectiveFrom: string; payslip: Payslip; attendanceWitness: number }
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
      retenueAbsence: Math.max(manualRetenue, 0),
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
    attendanceWitness,
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
function computeMonthlyLine(p: PayrollEmployeeProfile, rates: PayrollRates, l: PayrollMonthlyLine): Payslip {
  const gross = num(p.grossContractual);
  const base = Math.round(gross * num(p.basePct));
  const extraTaxable = num(l.primes) + num(l.heuresSup);
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
      internal: { avance: num(l.avance), pret: num(l.pret), retard: num(l.retard), autres: num(l.autres) + num(l.sanction) },
    },
    rates,
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
  | { period: string; rate_effective_from: string; lines: RegisterLine[]; totals: { brut: number; net: number; charges_pat: number }; monthly_status: "brouillon" | "valide" | null }
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
    const gross = num(p.grossContractual);
    const base = Math.round(gross * num(p.basePct));
    const monthLine = lineByEmp.get(p.employeeId);
    const ps = monthLine
      ? computeMonthlyLine(p, rates, monthLine)
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
  return { period, rate_effective_from: rateSet.effectiveFrom.toISOString().slice(0, 10), lines, totals, monthly_status: run?.status ?? null };
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
