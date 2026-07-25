import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ContractType, ContractStatus, RoyaltyBase, SignatureParty, StatementPeriodicity } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import { nextContractNumber } from "../lib/contractNumber.js";

// Bornes réglementaires du taux de droits d'auteur (décision opérateur du
// 20/07/2026) : réglable par ouvrage, mais toujours entre 8 % et 15 %. Les
// contrats déjà signés ne sont pas recalculés (pas de mise à jour rétroactive).
const MIN_ROYALTY_RATE = 0.08;
const MAX_ROYALTY_RATE = 0.15;

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

const signContractSchema = z.object({
  party: z.nativeEnum(SignatureParty),
  signer_name: z.string().trim().min(2, "Nom du signataire requis.").max(200),
  note: z.string().max(1000).optional(),
  // Confirmation explicite de l'accord — la signature est un acte volontaire.
  consent: z.boolean(),
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

    // Taux de droits d'auteur borné à 8 %–15 % par ouvrage (contrôle serveur, en
    // plus du choix côté écran). S'applique à chaque palier saisi.
    for (const tier of body.financial_terms.tiers ?? []) {
      if (tier.rate < MIN_ROYALTY_RATE - 1e-9 || tier.rate > MAX_ROYALTY_RATE + 1e-9) {
        return reply.code(400).send({
          code: "royalty_rate_out_of_bounds",
          message: `Le taux de droits d'auteur doit être compris entre 8 % et 15 % (valeur reçue : ${(tier.rate * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %).`,
        });
      }
    }

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
      include: {
        partner: true,
        manuscript: true,
        royaltyTerms: true,
        amendments: true,
        signatures: { orderBy: { signedAt: "asc" } },
      },
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

  // Signature « simple / interne » d'un contrat (Phase B, décision opérateur du
  // 10/07/2026). L'accord d'une partie (auteur/prestataire ou maison) est
  // enregistré, horodaté et lié à une empreinte des clauses signées — puis
  // tracé au journal inviolable. Le contrat n'est activé qu'une fois la partie
  // contractante (auteur) engagée. Réservé à la validation juridique, comme le
  // circuit de statut, et n'est possible qu'en « attente de signature ».
  fastify.post(
    "/api/v1/contracts/:id/sign",
    { preHandler: requirePermission("contracts", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = signContractSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      if (!parsed.data.consent) {
        return reply.code(400).send({
          code: "consent_required",
          message: "La signature exige la confirmation explicite de l'accord de la partie signataire.",
        });
      }

      const contract = await prisma.contract.findFirst({
        where: { id, deletedAt: null },
        include: { partner: true, royaltyTerms: true, signatures: true },
      });
      if (!contract) {
        return reply.code(404).send({ code: "not_found", message: "Contrat introuvable." });
      }
      if (contract.status !== "awaiting_signature" && contract.status !== "active") {
        return reply.code(409).send({
          code: "not_awaiting_signature",
          message: `La signature n'est possible qu'en « attente de signature » (statut actuel : « ${contract.status} »).`,
        });
      }

      // Une même partie ne signe qu'une fois (idempotence métier).
      if (contract.signatures.some((s) => s.party === parsed.data.party)) {
        return reply.code(409).send({
          code: "already_signed",
          message: `La partie « ${parsed.data.party === "author" ? "contractante" : "maison"} » a déjà signé ce contrat.`,
        });
      }

      // Empreinte des clauses effectivement signées : garantit que la signature
      // porte sur cette version des termes (intégrité). Ne dépend que du contenu.
      const termsHash = contractTermsHash(contract);

      // La partie contractante (auteur) engage le contrat → activation.
      const activates = parsed.data.party === "author" && contract.status === "awaiting_signature";
      const signedAtDate = new Date();

      await prisma.$transaction(async (tx) => {
        await tx.contractSignature.create({
          data: {
            contractId: id,
            party: parsed.data.party,
            signerName: parsed.data.signer_name.trim(),
            recordedById: request.user!.id,
            termsHash,
            note: parsed.data.note?.trim() || null,
          },
        });
        if (activates) {
          await tx.contract.update({
            where: { id },
            data: { status: "active", signedAt: contract.signedAt ?? signedAtDate, updatedBy: request.user!.id },
          });
        }
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "contract",
        entityId: id,
        newValues: {
          signature: { party: parsed.data.party, signer_name: parsed.data.signer_name.trim(), terms_hash: termsHash },
          ...(activates ? { status: "active" } : {}),
        },
        ipAddress: request.ip,
      });

      const refreshed = await prisma.contract.findFirst({
        where: { id },
        include: {
          partner: true,
          manuscript: true,
          royaltyTerms: true,
          amendments: true,
          signatures: { orderBy: { signedAt: "asc" } },
        },
      });
      return reply.send(refreshed);
    },
  );
}

// Empreinte stable des clauses signées : uniquement le contenu contractuel
// (numéro, type, partie, portée, durée, termes financiers). Indépendante des
// champs d'audit, pour qu'une même version de termes produise toujours la même
// empreinte.
function contractTermsHash(contract: {
  contractNumber: string;
  type: string;
  partnerId: string;
  territories: string[];
  languages: string[];
  formats: string[];
  durationMonths: number | null;
  financialTerms: unknown;
}): string {
  const canonical = JSON.stringify({
    contractNumber: contract.contractNumber,
    type: contract.type,
    partnerId: contract.partnerId,
    territories: [...contract.territories].sort(),
    languages: [...contract.languages].sort(),
    formats: [...contract.formats].sort(),
    durationMonths: contract.durationMonths,
    financialTerms: contract.financialTerms,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
