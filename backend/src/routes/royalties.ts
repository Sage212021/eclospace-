import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { assertPeriodOpen, PeriodClosedError } from "../lib/accountingPeriod.js";
import { sendMail, senderIdentity } from "../lib/mailer.js";
import { buildRoyaltyStatementEmail } from "../lib/documentEmail.js";
import { authorRoyaltiesByYear } from "../lib/authorRoyalties.js";

const statementEmailSchema = z.object({
  to: z.string().email().optional(),
  message: z.string().max(4000).optional(),
  preview: z.boolean().optional(),
});

const statementSchema = z.object({
  period_start: z.string().datetime(),
  period_end: z.string().datetime(),
});

const paymentSchema = z.object({
  method: z.string().min(1),
  bank_account_id: z.string().uuid().optional(),
  tax_withheld: z.number().nonnegative().optional(), // absolute montant ; défaut = tax_withholding_pct du contrat
  amount: z.number().positive().optional(), // paiement partiel (brut) ; défaut = solde restant
});

const beneficiariesSchema = z.object({
  beneficiaries: z
    .array(z.object({ partner_id: z.string().uuid(), share_pct: z.number().positive().max(100) }))
    .min(1),
});

async function computeSettledAmount(tx: typeof prisma, statementId: string): Promise<number> {
  const payments = await tx.royaltyPayment.findMany({ where: { statementId } });
  return payments.reduce((sum, p) => sum + Number(p.amount) + Number(p.taxWithheld), 0);
}

// Ch. 9 §9.5, Ch. 18 §18.7 : exécution financière du moteur de calcul des
// droits d'auteur — relevés par période (amortissement de l'à-valoir) et
// ordres de paiement, en aval des royalty_entries générées automatiquement
// par les ventes et retours (lib/royalty.ts).
export default async function royaltiesRoutes(fastify: FastifyInstance) {
  // État annuel des droits d'auteur PAR AUTEUR (tous ses ouvrages) : droits
  // acquis par livre avec le taux appliqué + récapitulatif fiscal de l'année
  // (versé brut, retenue à la source, net). Sert l'impression de l'état annuel.
  fastify.get(
    "/api/v1/royalties/by-author",
    { preHandler: requirePermission("royalties", "consultation") },
    async (request, reply) => {
      const q = request.query as { year?: string; partner_id?: string };
      const year = Number.isInteger(Number(q.year)) && Number(q.year) > 2000 ? Number(q.year) : new Date().getFullYear();
      const result = await authorRoyaltiesByYear({ year, partnerId: q.partner_id });
      return reply.send(result);
    },
  );

  fastify.get(
    "/api/v1/contracts/:id/royalty-entries",
    { preHandler: requirePermission("royalties", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const entries = await prisma.royaltyEntry.findMany({
        where: { contractId: id },
        orderBy: { computedAt: "desc" },
      });
      return reply.send(entries);
    },
  );

  // Répartition entre plusieurs bénéficiaires d'un même contrat (revue
  // opérateur du 04/07/2026 : auteur + illustrateur, coauteurs...). Remplace
  // la liste complète à chaque appel (cohérence garantie : la somme des
  // parts doit toujours faire 100 %) ; le calcul des droits reste au niveau
  // du contrat, seule l'exécution du paiement répartit le montant.
  fastify.post(
    "/api/v1/contracts/:id/beneficiaries",
    { preHandler: requirePermission("royalties", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = beneficiariesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const contract = await prisma.contract.findUnique({ where: { id } });
      if (!contract) {
        return reply.code(404).send({ code: "not_found", message: "Contrat introuvable." });
      }
      const partnerIds = new Set(parsed.data.beneficiaries.map((b) => b.partner_id));
      if (partnerIds.size !== parsed.data.beneficiaries.length) {
        return reply.code(400).send({ code: "validation_error", message: "Un même partenaire ne peut apparaître qu'une seule fois." });
      }
      const totalShare = parsed.data.beneficiaries.reduce((sum, b) => sum + b.share_pct, 0);
      if (Math.abs(totalShare - 100) > 0.01) {
        return reply.code(400).send({
          code: "validation_error",
          message: `La somme des parts doit faire 100 % (calculée : ${totalShare} %).`,
        });
      }

      const beneficiaries = await prisma.$transaction(async (tx) => {
        await tx.contractBeneficiary.deleteMany({ where: { contractId: id } });
        await tx.contractBeneficiary.createMany({
          data: parsed.data.beneficiaries.map((b) => ({ contractId: id, partnerId: b.partner_id, sharePct: b.share_pct })),
        });
        return tx.contractBeneficiary.findMany({ where: { contractId: id }, include: { partner: true } });
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "contract_beneficiaries",
        entityId: id,
        newValues: { beneficiaries: parsed.data.beneficiaries },
        ipAddress: request.ip,
      });

      return reply.code(201).send(beneficiaries);
    },
  );

  fastify.get(
    "/api/v1/contracts/:id/beneficiaries",
    { preHandler: requirePermission("royalties", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const beneficiaries = await prisma.contractBeneficiary.findMany({ where: { contractId: id }, include: { partner: true } });
      return reply.send(beneficiaries);
    },
  );

  fastify.get(
    "/api/v1/royalty-statements",
    { preHandler: requirePermission("royalties", "consultation") },
    async (request, reply) => {
      const query = request.query as { contract_id?: string };
      const statements = await prisma.royaltyStatement.findMany({
        where: query.contract_id ? { contractId: query.contract_id } : {},
        include: { contract: { include: { partner: true } }, payments: true },
        orderBy: { periodEnd: "desc" },
      });
      const withRemaining = statements.map(({ payments, ...statement }) => {
        const settled = payments.reduce((sum, p) => sum + Number(p.amount) + Number(p.taxWithheld), 0);
        return { ...statement, remaining_balance: Math.round((Number(statement.balanceDue) - settled) * 100) / 100 };
      });
      return reply.send(withRemaining);
    },
  );

  fastify.get(
    "/api/v1/royalty-statements/:id",
    { preHandler: requirePermission("royalties", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const statement = await prisma.royaltyStatement.findUnique({
        where: { id },
        include: { contract: { include: { partner: true } }, entries: true, payments: { include: { partner: true } } },
      });
      if (!statement) {
        return reply.code(404).send({ code: "not_found", message: "Relevé de droits introuvable." });
      }
      const settled = await computeSettledAmount(prisma, id);
      const remainingBalance = Math.round((Number(statement.balanceDue) - settled) * 100) / 100;
      return reply.send({ ...statement, remaining_balance: remainingBalance });
    },
  );

  // Envoi d'un relevé de droits par e-mail (Phase A) : le corps de l'e-mail EST
  // le relevé (rendu serveur). `preview` renvoie l'aperçu sans envoyer. Le
  // destinataire connu est l'e-mail de l'auteur (partenaire) du contrat.
  fastify.post(
    "/api/v1/royalty-statements/:id/email",
    { preHandler: requirePermission("royalties", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = statementEmailSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const statement = await prisma.royaltyStatement.findUnique({
        where: { id },
        include: { contract: { include: { partner: true } }, entries: true },
      });
      if (!statement) {
        return reply.code(404).send({ code: "not_found", message: "Relevé de droits introuvable." });
      }
      const settled = await computeSettledAmount(prisma, id);
      const remaining = Math.round((Number(statement.balanceDue) - settled) * 100) / 100;
      const built = buildRoyaltyStatementEmail({ ...statement, remaining_balance: remaining }, parsed.data.message ?? "");

      if (parsed.data.preview) {
        return reply.send({ subject: built.subject, html: built.html, default_to: statement.contract.partner.email ?? null });
      }

      const to = parsed.data.to?.trim();
      if (!to) {
        return reply.code(400).send({ code: "missing_recipient", message: "Renseignez l'adresse e-mail du destinataire." });
      }
      let sent: boolean;
      try {
        const sender = senderIdentity(request.user!);
        sent = await sendMail({ to, subject: built.subject, text: built.text, html: built.html, ...sender });
      } catch (err) {
        if (err instanceof Error && err.message === "mail_not_configured") {
          return reply.code(503).send({
            code: "mail_not_configured",
            message: "L'envoi d'e-mails n'est pas encore configuré (paramètres SMTP à renseigner sur l'hébergement).",
          });
        }
        throw err;
      }
      await writeAuditLog({
        userId: request.user!.id,
        action: "export",
        entityType: "royalty_statement_email",
        entityId: id,
        newValues: { to, sent },
        ipAddress: request.ip,
      });
      return reply.send({ sent, to });
    },
  );

  // Génération « en un clic » (§9.5) : agrège les royalty_entries non encore
  // rattachées à un relevé sur la période, amortit l'à-valoir restant, calcule
  // le solde dû. Idempotent par contrat+période : un relevé déjà émis sur une
  // période chevauchante est refusé plutôt que doublé.
  fastify.post(
    "/api/v1/contracts/:id/royalty-statements",
    { preHandler: requirePermission("royalties", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = statementSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const periodStart = new Date(parsed.data.period_start);
      const periodEnd = new Date(parsed.data.period_end);
      if (periodEnd <= periodStart) {
        return reply.code(400).send({ code: "validation_error", message: "La fin de période doit suivre son début." });
      }

      const contract = await prisma.contract.findUnique({ where: { id }, include: { royaltyTerms: true } });
      if (!contract || !contract.royaltyTerms) {
        return reply.code(404).send({ code: "not_found", message: "Contrat ou clauses de droits d'auteur introuvables." });
      }

      const overlapping = await prisma.royaltyStatement.findFirst({
        where: { contractId: id, periodStart: { lt: periodEnd }, periodEnd: { gt: periodStart } },
      });
      if (overlapping) {
        return reply.code(409).send({
          code: "period_overlap",
          message: "Un relevé existe déjà sur une période chevauchante pour ce contrat.",
        });
      }

      try {
        const statement = await prisma.$transaction(async (tx) => {
          await assertPeriodOpen(tx);
          const entries = await tx.royaltyEntry.findMany({
            where: { contractId: id, statementId: null, computedAt: { gte: periodStart, lt: periodEnd } },
          });
          const totalEarned = entries.reduce((sum, e) => sum + Number(e.amount), 0);

          const priorStatements = await tx.royaltyStatement.aggregate({
            where: { contractId: id },
            _sum: { advanceRecouped: true },
          });
          const advanceAmount = Number(contract.royaltyTerms!.advanceAmount ?? 0);
          const alreadyRecouped = Number(priorStatements._sum.advanceRecouped ?? 0);
          const remainingAdvance = Math.max(advanceAmount - alreadyRecouped, 0);
          const advanceRecouped = Math.min(Math.max(totalEarned, 0), remainingAdvance);
          const balanceDue = Math.round((totalEarned - advanceRecouped) * 100) / 100;

          const created = await tx.royaltyStatement.create({
            data: {
              contractId: id,
              periodStart,
              periodEnd,
              totalEarned: Math.round(totalEarned * 100) / 100,
              advanceRecouped: Math.round(advanceRecouped * 100) / 100,
              balanceDue,
              status: "issued",
              createdBy: request.user!.id,
            },
          });

          await tx.royaltyEntry.updateMany({
            where: { id: { in: entries.map((e) => e.id) } },
            data: { statementId: created.id },
          });

          return created;
        });

        await writeAuditLog({
          userId: request.user!.id,
          action: "create",
          entityType: "royalty_statement",
          entityId: statement.id,
          newValues: statement,
          ipAddress: request.ip,
        });

        return reply.code(201).send(statement);
      } catch (err) {
        if (err instanceof PeriodClosedError) {
          return reply.code(409).send({ code: "accounting_period_closed", message: err.message });
        }
        throw err;
      }
    },
  );

  // Ordre de paiement (§9.5, §18.7) : accepte un montant brut partiel (défaut
  // = solde restant) et répartit le montant entre les bénéficiaires du
  // contrat (revue opérateur du 04/07/2026) — un seul bénéficiaire implicite
  // (le partenaire du contrat, 100 %) si aucune répartition n'est configurée.
  // La retenue fiscale par défaut du contrat s'applique si non explicitement
  // surchargée dans la requête.
  fastify.post(
    "/api/v1/royalty-statements/:id/payments",
    { preHandler: requirePermission("royalties", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = paymentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const statement = await prisma.royaltyStatement.findUnique({
        where: { id },
        include: { contract: { include: { royaltyTerms: true } } },
      });
      if (!statement) {
        return reply.code(404).send({ code: "not_found", message: "Relevé de droits introuvable." });
      }
      if (statement.status === "paid") {
        return reply.code(409).send({ code: "already_paid", message: "Ce relevé de droits est déjà réglé." });
      }
      const settled = await computeSettledAmount(prisma, id);
      const remaining = Math.round((Number(statement.balanceDue) - settled) * 100) / 100;
      if (remaining <= 0) {
        return reply.code(409).send({
          code: "no_balance_due",
          message: "Aucun solde dû sur ce relevé (à-valoir non encore couvert par les droits générés).",
        });
      }

      const grossAmount = parsed.data.amount ?? remaining;
      if (grossAmount > remaining + 0.01) {
        return reply.code(400).send({
          code: "validation_error",
          message: `Le montant demandé (${grossAmount}) dépasse le solde restant (${remaining}).`,
        });
      }

      const defaultWithholdingPct = Number(statement.contract.royaltyTerms?.taxWithholdingPct ?? 0);
      const taxWithheld = parsed.data.tax_withheld ?? Math.round(((grossAmount * defaultWithholdingPct) / 100) * 100) / 100;
      const netAmount = Math.round((grossAmount - taxWithheld) * 100) / 100;
      if (netAmount <= 0) {
        return reply.code(400).send({ code: "validation_error", message: "La retenue fiscale ne peut excéder le montant brut." });
      }

      const beneficiaries = await prisma.contractBeneficiary.findMany({ where: { contractId: statement.contractId } });
      const splits =
        beneficiaries.length > 0
          ? beneficiaries.map((b) => ({ partnerId: b.partnerId as string | null, sharePct: Number(b.sharePct) }))
          : [{ partnerId: statement.contract.partnerId as string | null, sharePct: 100 }];

      try {
        const created = await prisma.$transaction(async (tx) => {
          await assertPeriodOpen(tx);
          const rows = [];
          let allocatedGross = 0;
          let allocatedTax = 0;
          for (let i = 0; i < splits.length; i++) {
            const isLast = i === splits.length - 1;
            const splitGross = isLast
              ? Math.round((grossAmount - allocatedGross) * 100) / 100
              : Math.round(((grossAmount * splits[i].sharePct) / 100) * 100) / 100;
            const splitTax = isLast
              ? Math.round((taxWithheld - allocatedTax) * 100) / 100
              : Math.round(((taxWithheld * splits[i].sharePct) / 100) * 100) / 100;
            allocatedGross += splitGross;
            allocatedTax += splitTax;
            const splitNet = Math.round((splitGross - splitTax) * 100) / 100;
            if (splitNet <= 0) continue;
            const payment = await tx.payment.create({
              data: {
                direction: "out",
                method: parsed.data.method,
                amount: splitNet,
                bankAccountId: parsed.data.bank_account_id,
                createdBy: request.user!.id,
              },
            });
            const royaltyPayment = await tx.royaltyPayment.create({
              data: { statementId: id, partnerId: splits[i].partnerId ?? undefined, amount: splitNet, taxWithheld: splitTax, paymentId: payment.id },
            });
            rows.push(royaltyPayment);
          }
          const newSettled = settled + grossAmount;
          if (newSettled >= Number(statement.balanceDue) - 0.01) {
            await tx.royaltyStatement.update({ where: { id }, data: { status: "paid" } });
          }
          return rows;
        });

        for (const row of created) {
          await writeAuditLog({
            userId: request.user!.id,
            action: "create",
            entityType: "royalty_payment",
            entityId: row.id,
            newValues: row,
            ipAddress: request.ip,
          });
        }

        const remainingAfter = Math.round((remaining - grossAmount) * 100) / 100;
        // Rétrocompatibilité : un paiement à un seul bénéficiaire (cas le plus
        // fréquent, aucune répartition configurée) renvoie l'objet à plat
        // comme avant l'ajout de la répartition multi-bénéficiaires.
        if (created.length === 1) {
          return reply.code(201).send({ ...created[0], remaining_balance: remainingAfter });
        }
        return reply.code(201).send({ payments: created, remaining_balance: remainingAfter });
      } catch (err) {
        if (err instanceof PeriodClosedError) {
          return reply.code(409).send({ code: "accounting_period_closed", message: err.message });
        }
        throw err;
      }
    },
  );
}
