import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PaymentMethod } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { assertPeriodOpen, PeriodClosedError } from "../lib/accountingPeriod.js";

const statementSchema = z.object({
  period_start: z.string().datetime(),
  period_end: z.string().datetime(),
});

const paymentSchema = z.object({
  method: z.nativeEnum(PaymentMethod),
  bank_account_id: z.string().uuid().optional(),
  tax_withheld: z.number().nonnegative().default(0),
});

// Ch. 9 §9.5, Ch. 18 §18.7 : exécution financière du moteur de calcul des
// droits d'auteur — relevés par période (amortissement de l'à-valoir) et
// ordres de paiement, en aval des royalty_entries générées automatiquement
// par les ventes et retours (lib/royalty.ts).
export default async function royaltiesRoutes(fastify: FastifyInstance) {
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

  fastify.get(
    "/api/v1/royalty-statements",
    { preHandler: requirePermission("royalties", "consultation") },
    async (request, reply) => {
      const query = request.query as { contract_id?: string };
      const statements = await prisma.royaltyStatement.findMany({
        where: query.contract_id ? { contractId: query.contract_id } : {},
        include: { contract: { include: { partner: true } } },
        orderBy: { periodEnd: "desc" },
      });
      return reply.send(statements);
    },
  );

  fastify.get(
    "/api/v1/royalty-statements/:id",
    { preHandler: requirePermission("royalties", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const statement = await prisma.royaltyStatement.findUnique({
        where: { id },
        include: { contract: { include: { partner: true } }, entries: true, payments: true },
      });
      if (!statement) {
        return reply.code(404).send({ code: "not_found", message: "Relevé de droits introuvable." });
      }
      return reply.send(statement);
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

  // Ordre de paiement (§9.5, §18.7) : solde le relevé, retenues fiscales
  // applicables déduites du montant net versé.
  fastify.post(
    "/api/v1/royalty-statements/:id/payments",
    { preHandler: requirePermission("royalties", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = paymentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const statement = await prisma.royaltyStatement.findUnique({ where: { id } });
      if (!statement) {
        return reply.code(404).send({ code: "not_found", message: "Relevé de droits introuvable." });
      }
      if (statement.status === "paid") {
        return reply.code(409).send({ code: "already_paid", message: "Ce relevé de droits est déjà réglé." });
      }
      if (Number(statement.balanceDue) <= 0) {
        return reply.code(409).send({
          code: "no_balance_due",
          message: "Aucun solde dû sur ce relevé (à-valoir non encore couvert par les droits générés).",
        });
      }
      const netAmount = Math.round((Number(statement.balanceDue) - parsed.data.tax_withheld) * 100) / 100;
      if (netAmount <= 0) {
        return reply.code(400).send({ code: "validation_error", message: "La retenue fiscale ne peut excéder le solde dû." });
      }

      try {
        const result = await prisma.$transaction(async (tx) => {
          await assertPeriodOpen(tx);
          const payment = await tx.payment.create({
            data: {
              direction: "out",
              method: parsed.data.method,
              amount: netAmount,
              bankAccountId: parsed.data.bank_account_id,
              createdBy: request.user!.id,
            },
          });
          const royaltyPayment = await tx.royaltyPayment.create({
            data: {
              statementId: id,
              amount: netAmount,
              taxWithheld: parsed.data.tax_withheld,
              paymentId: payment.id,
            },
          });
          await tx.royaltyStatement.update({ where: { id }, data: { status: "paid" } });
          return royaltyPayment;
        });

        await writeAuditLog({
          userId: request.user!.id,
          action: "create",
          entityType: "royalty_payment",
          entityId: result.id,
          newValues: result,
          ipAddress: request.ip,
        });

        return reply.code(201).send(result);
      } catch (err) {
        if (err instanceof PeriodClosedError) {
          return reply.code(409).send({ code: "accounting_period_closed", message: err.message });
        }
        throw err;
      }
    },
  );
}
