import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ContractType, ContractStatus, RoyaltyBase, StatementPeriodicity } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { nextContractNumber } from "../lib/contractNumber.js";

const financialTermsSchema = z
  .object({
    base: z.nativeEnum(RoyaltyBase).optional(),
    tiers: z.array(z.object({ up_to: z.number().nullable(), rate: z.number() })).optional(),
    advance_amount: z.number().optional(),
    payment_schedule: z.string().optional(),
    // Revue opérateur du 04/07/2026 : retenue fiscale par défaut et
    // périodicité indicative des relevés, au niveau du contrat.
    tax_withholding_pct: z.number().min(0).max(100).optional(),
    statement_periodicity: z.nativeEnum(StatementPeriodicity).optional(),
  })
  .catchall(z.unknown());

const createContractSchema = z.object({
  type: z.nativeEnum(ContractType),
  manuscript_id: z.string().uuid().optional(),
  partner_id: z.string().uuid(),
  parent_contract_id: z.string().uuid().optional(),
  territories: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  formats: z.array(z.string()).default([]),
  duration_months: z.number().int().positive().optional(),
  financial_terms: financialTermsSchema,
});

// Circuit de validation (Ch. 9 §9.8) : on n'avance que d'un cran, jamais de saut.
const STATUS_CHAIN: ContractStatus[] = [
  "preparation",
  "legal_review",
  "direction_approval",
  "awaiting_signature",
  "active",
];

const patchStatusSchema = z.object({
  status: z.nativeEnum(ContractStatus),
  signed_at: z.coerce.date().optional(),
});

const listQuerySchema = z.object({
  expiring_before: z.coerce.date().optional(),
  status: z.nativeEnum(ContractStatus).optional(),
  manuscript: z.string().uuid().optional(),
});

// Juridique et contrats (Ch. 9) — hors moteur de droits connecté aux ventes (Lot 5).
export default async function contractRoutes(fastify: FastifyInstance) {
  fastify.post("/api/v1/contracts", { preHandler: requirePermission("contracts", "saisie") }, async (request, reply) => {
    const parsed = createContractSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const body = parsed.data;
    const contractNumber = await nextContractNumber();

    const contract = await prisma.$transaction(async (tx) => {
      const created = await tx.contract.create({
        data: {
          contractNumber,
          type: body.type,
          manuscriptId: body.manuscript_id,
          partnerId: body.partner_id,
          parentContractId: body.parent_contract_id,
          territories: body.territories,
          languages: body.languages,
          formats: body.formats,
          durationMonths: body.duration_months,
          financialTerms: JSON.parse(JSON.stringify(body.financial_terms)),
          createdBy: request.user!.id,
          updatedBy: request.user!.id,
        },
      });

      if (body.financial_terms.base && body.financial_terms.tiers) {
        await tx.royaltyTerms.create({
          data: {
            contractId: created.id,
            base: body.financial_terms.base,
            tiers: body.financial_terms.tiers,
            advanceAmount: body.financial_terms.advance_amount,
            paymentSchedule: body.financial_terms.payment_schedule,
            taxWithholdingPct: body.financial_terms.tax_withholding_pct,
            statementPeriodicity: body.financial_terms.statement_periodicity,
          },
        });
      }

      return created;
    });

    await writeAuditLog({
      userId: request.user!.id,
      action: "create",
      entityType: "contract",
      entityId: contract.id,
      newValues: { contractNumber, type: body.type, partnerId: body.partner_id },
      ipAddress: request.ip,
    });

    return reply.code(201).send(contract);
  });

  fastify.get("/api/v1/contracts", { preHandler: requirePermission("contracts", "consultation") }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Paramètres invalides.", details: parsed.error.issues });
    }
    const { expiring_before, status, manuscript } = parsed.data;

    // L'échéance se déduit de effective_at + duration_months (pas de champ dédié) :
    // filtrée en mémoire, le volume Lot 2 restant modeste.
    const contracts = await prisma.contract.findMany({
      where: {
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(manuscript ? { manuscriptId: manuscript } : {}),
      },
      include: { partner: true, manuscript: { select: { id: true, manuscriptNumber: true, title: true } } },
      orderBy: { createdAt: "desc" },
    });

    const filtered = expiring_before
      ? contracts.filter((c) => {
          if (!c.effectiveAt || !c.durationMonths) return false;
          const expiry = new Date(c.effectiveAt);
          expiry.setMonth(expiry.getMonth() + c.durationMonths);
          return expiry <= expiring_before;
        })
      : contracts;

    return reply.send(filtered);
  });

  fastify.get("/api/v1/contracts/:id", { preHandler: requirePermission("contracts", "consultation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    // Consultation journalisée (Ch. 9 §9.11) : la sensibilité juridique
    // justifie de tracer même les accès en lecture seule.
    await writeAuditLog({
      userId: request.user!.id,
      action: "view_sensitive",
      entityType: "contract",
      entityId: id,
      ipAddress: request.ip,
    });

    const contract = await prisma.contract.findFirst({
      where: { id, deletedAt: null },
      include: { partner: true, manuscript: true, royaltyTerms: true, amendments: true },
    });
    if (!contract) {
      return reply.code(404).send({ code: "not_found", message: "Contrat introuvable." });
    }
    return reply.send(contract);
  });

  fastify.patch(
    "/api/v1/contracts/:id/status",
    { preHandler: requirePermission("contracts", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = patchStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }

      const contract = await prisma.contract.findFirst({ where: { id, deletedAt: null } });
      if (!contract) {
        return reply.code(404).send({ code: "not_found", message: "Contrat introuvable." });
      }

      const { status: nextStatus, signed_at } = parsed.data;
      const currentIndex = STATUS_CHAIN.indexOf(contract.status);
      const nextIndex = STATUS_CHAIN.indexOf(nextStatus);
      const isSequentialAdvance = currentIndex >= 0 && nextIndex === currentIndex + 1;
      const isTermination = contract.status === "active" && (nextStatus === "terminated" || nextStatus === "expired");

      if (!isSequentialAdvance && !isTermination) {
        return reply.code(409).send({
          code: "status_out_of_order",
          message: `Passage de « ${contract.status} » à « ${nextStatus} » non autorisé par le circuit de validation.`,
        });
      }

      const updated = await prisma.contract.update({
        where: { id },
        data: { status: nextStatus, signedAt: signed_at ?? contract.signedAt, updatedBy: request.user!.id },
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "status_change",
        entityType: "contract",
        entityId: id,
        oldValues: { status: contract.status },
        newValues: { status: nextStatus },
        ipAddress: request.ip,
      });

      return reply.send(updated);
    },
  );
}
