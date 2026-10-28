import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ContractDispatchChannel, ContractDocumentKind, ContractType, ContractStatus, EconomicModel, RoyaltyBase, SignatureParty, StatementPeriodicity } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requirePermission } from "../lib/permissions.js";
import { canPrepareContractForManuscript } from "../lib/contractualisation.js";
import { writeAuditLog } from "../lib/audit.js";

// Autorisation « saisie » des contrats avec ACCÈS SCOPÉ pour la
// contractualisation (demande opérateur 16/10) : en plus des profils porteurs du
// droit « contracts:saisie » (Juridique…), le DG — ou le délégué qu'il a
// désigné — peut établir/compléter le contrat et déposer le scan signé, mais
// UNIQUEMENT pour le dossier qui est en contractualisation. On n'ouvre jamais le
// module Contrats en grand à RH/DAF/Éditorial.
function allowContractSaisie() {
  return async function contractSaisiePreHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) {
      reply.code(401).send({ code: "unauthenticated", message: "Connexion requise." });
      return;
    }
    if (request.user.permissions.has("contracts:saisie")) return;
    // Dériver le manuscrit : via le contrat (routes /:id/…) ou via le corps
    // (création d'un contrat). Les routes multipart n'utilisent que params.id.
    const params = request.params as { id?: string };
    let manuscriptId: string | null = null;
    if (params.id) {
      const contract = await prisma.contract.findUnique({ where: { id: params.id }, select: { manuscriptId: true } });
      manuscriptId = contract?.manuscriptId ?? null;
    } else {
      const body = request.body as { manuscript_id?: string } | undefined;
      manuscriptId = body?.manuscript_id ?? null;
    }
    if (await canPrepareContractForManuscript(request.user, manuscriptId)) return;
    void writeAuditLog({ userId: request.user.id, action: "access_denied", entityType: "permission", entityId: "contracts:saisie", newValues: { method: request.method, url: request.url }, ipAddress: request.ip }).catch(() => {});
    reply.code(403).send({ code: "forbidden", message: "Action non autorisée : droit « contrats (saisie) » requis — ou dossier non délégué / hors contractualisation." });
  };
}
import { nextContractNumber } from "../lib/contractNumber.js";
import { storeFile, readStoredFile } from "../lib/storage.js";
import { buildContractDeadline, runContractDeadlineAlerts } from "../lib/contractDeadlines.js";

const MAX_DOC_LABEL = 120;

// Résout un ensemble d'identifiants d'utilisateurs en noms lisibles (nom de
// l'employé si disponible, sinon identifiant de connexion) — pour la
// traçabilité affichée (« saisi par », « modifié par »).
async function resolveActorNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, username: true, employee: { select: { firstName: true, lastName: true } } },
  });
  const map = new Map<string, string>();
  for (const u of users) {
    const full = `${u.employee?.firstName ?? ""} ${u.employee?.lastName ?? ""}`.trim();
    map.set(u.id, full || u.username);
  }
  return map;
}

// Lecture d'un envoi multipart : le fichier + un champ texte « label » optionnel
// et un « kind » (signed_scan | annexe).
async function readContractUpload(
  request: FastifyRequest,
): Promise<{ buf: Buffer; name: string; mime: string; label: string; kind: ContractDocumentKind } | null> {
  if (!request.isMultipart()) return null;
  let buf: Buffer | null = null;
  let name = "fichier";
  let mime = "application/octet-stream";
  let label = "";
  let kind: ContractDocumentKind = "signed_scan";
  for await (const part of request.parts()) {
    if (part.type === "file") {
      buf = await part.toBuffer();
      name = part.filename || "fichier";
      mime = part.mimetype || "application/octet-stream";
    } else if (part.fieldname === "label" && typeof part.value === "string") {
      label = part.value.slice(0, MAX_DOC_LABEL);
    } else if (part.fieldname === "kind" && (part.value === "signed_scan" || part.value === "annexe")) {
      kind = part.value;
    }
  }
  if (!buf || buf.byteLength === 0) return null;
  return { buf, name, mime, label, kind };
}

function contractDocView(d: {
  id: string;
  kind: ContractDocumentKind;
  label: string;
  fileName: string;
  fileMime: string;
  fileSize: number;
  uploadedById: string | null;
  createdAt: Date;
}, actorNames: Map<string, string>) {
  return {
    id: d.id,
    kind: d.kind,
    label: d.label,
    name: d.fileName,
    mime: d.fileMime,
    size: d.fileSize,
    uploaded_by: d.uploadedById ? actorNames.get(d.uploadedById) ?? null : null,
    created_at: d.createdAt,
  };
}

// Bornes réglementaires du taux de droits d'auteur (décision opérateur du
// 20/07/2026) : entre 8 % et 15 %. Révision du 25/10/2026 (D-054) : cette
// fourchette ne s'impose PLUS qu'aux contrats d'ÉDITION à compte d'éditeur ;
// les autres modèles/types ont un taux libre (« ne pas imposer une fourchette
// unique à tous les contrats »). Les contrats déjà signés ne sont pas recalculés.
const MIN_ROYALTY_RATE = 0.08;
const MAX_ROYALTY_RATE = 0.15;

// La fourchette 8–15 % s'applique-t-elle à ce contrat ? Oui pour une édition à
// compte d'éditeur — ou une édition sans modèle précisé (contrats antérieurs à
// D-054 : comportement hérité conservé). Non ailleurs (taux libre).
function royaltyRangeEnforced(type: ContractType, economicModel: EconomicModel | null | undefined): boolean {
  if (type !== "edition") return false;
  return economicModel === "compte_editeur" || economicModel == null;
}

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
  economic_model: z.nativeEnum(EconomicModel).optional(),
  manuscript_id: z.string().uuid().optional(),
  partner_id: z.string().uuid(),
  parent_contract_id: z.string().uuid().optional(),
  territories: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  formats: z.array(z.string()).default([]),
  duration_months: z.number().int().positive().optional(),
  financial_terms: financialTermsSchema,
});

// Libellés lisibles des types de contrat (pour les messages d'erreur).
const CONTRACT_TYPE_LABELS: Record<string, string> = {
  edition: "édition",
  coedition: "coédition",
  cession: "cession de droits",
  traduction: "traduction",
  correction: "correction",
  illustration: "illustration",
  prestation: "prestation de services",
};

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
  fastify.post("/api/v1/contracts", { preHandler: allowContractSaisie() }, async (request, reply) => {
    const parsed = createContractSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    }
    const body = parsed.data;

    // Contrôle serveur des taux de droits d'auteur. Garde-fou générique d'abord
    // (un taux reste une fraction entre 0 et 100 %), puis la fourchette 8–15 %
    // UNIQUEMENT pour une édition à compte d'éditeur (D-054) — ailleurs, le taux
    // est libre à la demande de l'opérateur.
    const enforceRange = royaltyRangeEnforced(body.type, body.economic_model);
    for (const tier of body.financial_terms.tiers ?? []) {
      if (tier.rate < -1e-9 || tier.rate > 1 + 1e-9) {
        return reply.code(400).send({
          code: "royalty_rate_invalid",
          message: `Le taux de droits d'auteur doit être compris entre 0 % et 100 % (valeur reçue : ${(tier.rate * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %).`,
        });
      }
      if (enforceRange && (tier.rate < MIN_ROYALTY_RATE - 1e-9 || tier.rate > MAX_ROYALTY_RATE + 1e-9)) {
        return reply.code(400).send({
          code: "royalty_rate_out_of_bounds",
          message: `Pour un contrat d'édition à compte d'éditeur, le taux de droits d'auteur doit être compris entre 8 % et 15 % (valeur reçue : ${(tier.rate * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %).`,
        });
      }
    }

    // Garde anti-doublon (demande opérateur du 02/08/2026) : un même ouvrage ne
    // peut pas recevoir deux fois le MÊME contrat, c.-à-d. même partenaire ET même
    // type, tant qu'un tel contrat est encore en vie (ni résilié, ni expiré). Les
    // contrats différents (autre type, autre partenaire) restent autorisés — un
    // ouvrage a légitimement plusieurs contrats (édition, traduction, illustration…).
    // Nuance format (Ch. 9 §9.5) : un même ouvrage peut avoir un contrat papier ET
    // un contrat numérique séparés (formats disjoints, chacun son taux). Ce ne sont
    // donc des doublons que si leurs formats SE CHEVAUCHENT — un contrat sans
    // restriction de format (formats: []) couvre tout et chevauche n'importe lequel.
    if (body.manuscript_id) {
      const sameKey = await prisma.contract.findMany({
        where: {
          manuscriptId: body.manuscript_id,
          partnerId: body.partner_id,
          type: body.type,
          deletedAt: null,
          status: { notIn: ["terminated", "expired"] },
        },
        include: { partner: { select: { firstName: true, lastName: true } } },
      });
      const newFormats = body.formats;
      const overlaps = (existing: string[]) =>
        newFormats.length === 0 || existing.length === 0 || existing.some((f) => newFormats.includes(f));
      const duplicate = sameKey.find((c) => overlaps(c.formats));
      if (duplicate) {
        const who = `${duplicate.partner.firstName} ${duplicate.partner.lastName}`.trim();
        const label = CONTRACT_TYPE_LABELS[body.type] ?? body.type;
        return reply.code(409).send({
          code: "contract_duplicate",
          message: `Un contrat « ${label} » existe déjà pour cet ouvrage avec ${who} (${duplicate.contractNumber}). Modifiez le contrat existant plutôt que d'en créer un doublon.`,
          existing_contract_id: duplicate.id,
          existing_contract_number: duplicate.contractNumber,
        });
      }
    }

    const contractNumber = await nextContractNumber();

    const contract = await prisma.$transaction(async (tx) => {
      const created = await tx.contract.create({
        data: {
          contractNumber,
          type: body.type,
          economicModel: body.economic_model,
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

    // Traçabilité : qui a saisi / modifié en dernier chaque contrat.
    const actorNames = await resolveActorNames(filtered.flatMap((c) => [c.createdBy, c.updatedBy]));
    const withTrace = filtered.map((c) => ({
      ...c,
      createdByName: c.createdBy ? actorNames.get(c.createdBy) ?? null : null,
      updatedByName: c.updatedBy ? actorNames.get(c.updatedBy) ?? null : null,
    }));

    return reply.send(withTrace);
  });

  // Tableau de bord des contrats (chap. XII de la refonte) : répartition par
  // statut, avenants, avances contractuelles, échéances à venir + retards, et
  // contrats récemment supprimés (restaurables).
  fastify.get("/api/v1/contracts/dashboard", { preHandler: requirePermission("contracts", "consultation") }, async (_request, reply) => {
    const contracts = await prisma.contract.findMany({
      where: { deletedAt: null },
      include: {
        partner: { select: { firstName: true, lastName: true } },
        manuscript: { select: { title: true } },
        royaltyTerms: { select: { advanceAmount: true } },
        _count: { select: { amendments: true } },
      },
    });

    const byStatus: Record<string, number> = { preparation: 0, legal_review: 0, direction_approval: 0, awaiting_signature: 0, active: 0, expired: 0, terminated: 0 };
    let withAmendments = 0;
    let advancesTotal = 0;
    const now = new Date();

    // Échéances (date d'effet + durée) avec préavis de non-reconduction et niveau
    // de gravité — source unique partagée avec l'alerte de la Direction.
    const expiring = contracts
      .map((c) => buildContractDeadline(c, now))
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => a.days_left - b.days_left);

    for (const c of contracts) {
      byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
      if (c._count.amendments > 0) withAmendments += 1;
      if (c.royaltyTerms?.advanceAmount) advancesTotal += Number(c.royaltyTerms.advanceAmount);
    }

    // Alerte proactive de la Direction (best-effort, dédupliquée) : faute de tâche
    // planifiée dans cet hébergement, l'ouverture du tableau de bord contrats
    // déclenche l'envoi des alertes en attente. N'échoue jamais le tableau.
    await runContractDeadlineAlerts(now).catch(() => {});

    const deletedRows = await prisma.contract.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      take: 20,
      include: { partner: { select: { firstName: true, lastName: true } }, manuscript: { select: { title: true } } },
    });
    const deleted = deletedRows.map((c) => ({
      id: c.id, contract_number: c.contractNumber, title: c.manuscript?.title ?? null,
      partner_name: `${c.partner.firstName} ${c.partner.lastName}`.trim(), deleted_at: c.deletedAt?.toISOString() ?? null,
    }));

    return reply.send({
      total: contracts.length,
      by_status: byStatus,
      with_amendments: withAmendments,
      advances_total: advancesTotal,
      expiring,
      deleted,
    });
  });

  // Déclenchement manuel de l'alerte d'échéance (bouton « Vérifier maintenant »).
  // Renvoie le nombre d'alertes nouvellement envoyées à la Direction.
  fastify.post("/api/v1/contracts/alerts/run", { preHandler: requirePermission("contracts", "consultation") }, async (_request, reply) => {
    const created = await runContractDeadlineAlerts();
    return reply.send({ created });
  });

  // Restauration d'un contrat supprimé logiquement (chap. VIII/IX) — réservée à
  // la validation juridique, tracée au journal.
  fastify.post("/api/v1/contracts/:id/restore", { preHandler: requirePermission("contracts", "validation") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const contract = await prisma.contract.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!contract) return reply.code(404).send({ code: "not_found", message: "Contrat supprimé introuvable." });
    await prisma.contract.update({ where: { id }, data: { deletedAt: null, updatedBy: request.user!.id } });
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "contract", entityId: id, oldValues: { deleted: true }, newValues: { restored: true }, ipAddress: request.ip });
    return reply.send({ restored: true });
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
        dispatches: { orderBy: { sentAt: "desc" } },
      },
    });
    if (!contract) {
      return reply.code(404).send({ code: "not_found", message: "Contrat introuvable." });
    }
    // Traçabilité : noms lisibles du saisisseur et du dernier modificateur.
    const actorNames = await resolveActorNames([contract.createdBy, contract.updatedBy]);
    return reply.send({
      ...contract,
      createdByName: contract.createdBy ? actorNames.get(contract.createdBy) ?? null : null,
      updatedByName: contract.updatedBy ? actorNames.get(contract.updatedBy) ?? null : null,
    });
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
        data: {
          status: nextStatus,
          signedAt: signed_at ?? contract.signedAt,
          // La date de validation est posée au passage en « attente de signature »
          // (le circuit de validation est terminé), une seule fois.
          validatedAt: nextStatus === "awaiting_signature" && !contract.validatedAt ? new Date() : contract.validatedAt,
          // Idem que la signature activante : le passage « actif » fixe la date
          // d'effet (base de calcul de l'échéance) si elle n'est pas déjà posée.
          effectiveAt: nextStatus === "active" ? contract.effectiveAt ?? new Date() : contract.effectiveAt,
          updatedBy: request.user!.id,
        },
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

  // Modification des TERMES d'un contrat NON SIGNÉ (type, taux de droits, avance,
  // durée). Interdite dès qu'il porte une signature ou qu'il est actif / terminé
  // / expiré : un engagement signé est immuable (contrainte d'intégrité §13).
  // Réservée à la saisie contrats, tracée au journal.
  fastify.patch(
    "/api/v1/contracts/:id/terms",
    { preHandler: allowContractSaisie() },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z
        .object({
          type: z.nativeEnum(ContractType).optional(),
          economic_model: z.nativeEnum(EconomicModel).nullish(),
          duration_months: z.number().int().positive().max(1200).nullish(),
          rate: z.number().min(0).max(1).optional(),
          advance_amount: z.number().min(0).optional(),
          // Conditions de prestation (termes financiers JSON).
          service_cost: z.number().min(0).optional(),
          service_deposit: z.number().min(0).optional(),
          service_copies: z.number().int().min(0).optional(),
          service_delivery: z.string().max(400).optional(),
          // Conditions du contrat À COMPTE D'AUTEUR (termes financiers JSON).
          editorial_fees: z.number().min(0).optional(),
          print_copies: z.number().int().min(0).optional(),
          print_unit_cost: z.number().min(0).optional(),
          sale_price_min: z.number().min(0).optional(),
          logo_pct: z.number().min(0).max(100).optional(),
          distribution_pct: z.number().min(0).max(100).optional(),
          duration_years: z.number().int().min(0).max(99).optional(),
          territory: z.string().max(200).optional(),
          // Conditions du contrat À COMPTE À DEMI (termes financiers JSON).
          total_cost: z.number().min(0).optional(),
          author_cost_share_pct: z.number().min(0).max(100).optional(),
          author_revenue_share_pct: z.number().min(0).max(100).optional(),
          sale_price: z.number().min(0).optional(),
          statement_periodicity: z.enum(["mensuelle", "trimestrielle", "semestrielle", "annuelle"]).optional(),
          // Champs « à remplir » du contrat d'édition + date de signature (JSON).
          print_run: z.number().int().min(0).optional(),
          public_price_ht: z.number().min(0).optional(),
          publication_date: z.string().max(60).optional(),
          signing_date: z.string().max(60).optional(),
        })
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });

      const contract = await prisma.contract.findFirst({
        where: { id, deletedAt: null },
        include: { _count: { select: { signatures: true } }, royaltyTerms: true },
      });
      if (!contract) return reply.code(404).send({ code: "not_found", message: "Contrat introuvable." });
      const locked = ["active", "terminated", "expired"].includes(contract.status);
      if (locked || contract._count.signatures > 0) {
        return reply.code(409).send({
          code: "contract_signed",
          message: "Un contrat signé ou actif ne peut plus être modifié. Utilisez un avenant ou la résiliation le cas échéant.",
        });
      }

      const b = parsed.data;
      const before = { type: contract.type, durationMonths: contract.durationMonths, rate: contract.royaltyTerms?.tiers, advance: contract.royaltyTerms?.advanceAmount };

      await prisma.$transaction(async (tx) => {
        await tx.contract.update({
          where: { id },
          data: {
            type: b.type ?? contract.type,
            economicModel: b.economic_model === undefined ? contract.economicModel : b.economic_model,
            durationMonths: b.duration_months === undefined ? contract.durationMonths : b.duration_months,
            updatedBy: request.user!.id,
          },
        });
        // Taux / avance : portés par royaltyTerms (créés à la volée si absents).
        if (b.rate !== undefined || b.advance_amount !== undefined) {
          const tiers = b.rate !== undefined ? [{ up_to: null, rate: b.rate }] : (contract.royaltyTerms?.tiers ?? [{ up_to: null, rate: 0.1 }]);
          const advance = b.advance_amount !== undefined ? b.advance_amount : contract.royaltyTerms?.advanceAmount ?? 0;
          await tx.royaltyTerms.upsert({
            where: { contractId: id },
            create: { contractId: id, base: "prix_public_ht", tiers: tiers as object, advanceAmount: advance, paymentSchedule: "semestriel" },
            update: { tiers: tiers as object, advanceAmount: advance },
          });
          const fin = (contract.financialTerms as Record<string, unknown> | null) ?? { base: "prix_public_ht", payment_schedule: "semestriel" };
          fin.tiers = tiers;
          fin.advance_amount = advance;
          await tx.contract.update({ where: { id }, data: { financialTerms: JSON.parse(JSON.stringify(fin)) } });
        }
        // Conditions de prestation / à compte d'auteur : fusionnées dans les
        // termes financiers (JSON) sans toucher aux paliers de droits éventuels.
        const svcKeys = ["service_cost", "service_deposit", "service_copies", "service_delivery"] as const;
        const aaKeys = ["editorial_fees", "print_copies", "print_unit_cost", "sale_price_min", "logo_pct", "distribution_pct", "duration_years", "territory"] as const;
        const demiKeys = ["total_cost", "author_cost_share_pct", "author_revenue_share_pct", "sale_price", "statement_periodicity"] as const;
        const fillKeys = ["print_run", "public_price_ht", "publication_date", "signing_date"] as const;
        const touched = [...svcKeys, ...aaKeys, ...demiKeys, ...fillKeys].some((k) => b[k] !== undefined);
        if (touched) {
          const fin = (contract.financialTerms as Record<string, unknown> | null) ?? {};
          for (const k of svcKeys) if (b[k] !== undefined) fin[k] = typeof b[k] === "string" ? (b[k] as string).trim() : b[k];
          for (const k of aaKeys) if (b[k] !== undefined) fin[k] = typeof b[k] === "string" ? (b[k] as string).trim() : b[k];
          for (const k of demiKeys) if (b[k] !== undefined) fin[k] = typeof b[k] === "string" ? (b[k] as string).trim() : b[k];
          for (const k of fillKeys) if (b[k] !== undefined) fin[k] = typeof b[k] === "string" ? (b[k] as string).trim() : b[k];
          await tx.contract.update({ where: { id }, data: { financialTerms: JSON.parse(JSON.stringify(fin)) } });
        }
      });

      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "contract",
        entityId: id,
        oldValues: before,
        newValues: { type: b.type, durationMonths: b.duration_months, rate: b.rate, advance: b.advance_amount },
        ipAddress: request.ip,
      });

      const fresh = await prisma.contract.findUnique({ where: { id }, include: { royaltyTerms: true } });
      return reply.send(fresh);
    },
  );

  // Ajouter un ARTICLE additionnel (clause propre à ce contrat), repris en fin
  // de contrat imprimé / PDF. Possible tant que le contrat n'est pas signé.
  fastify.post(
    "/api/v1/contracts/:id/clauses",
    { preHandler: allowContractSaisie() },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ title: z.string().min(2).max(200), body: z.string().min(2).max(8000) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });

      const contract = await prisma.contract.findFirst({ where: { id, deletedAt: null }, include: { _count: { select: { signatures: true } } } });
      if (!contract) return reply.code(404).send({ code: "not_found", message: "Contrat introuvable." });
      const locked = ["active", "terminated", "expired"].includes(contract.status);
      if (locked || contract._count.signatures > 0) {
        return reply.code(409).send({ code: "contract_signed", message: "Un contrat signé ou actif ne peut plus être modifié. Utilisez un avenant le cas échéant." });
      }

      const existing = Array.isArray(contract.customClauses) ? (contract.customClauses as { title: string; body: string }[]) : [];
      const clauses = [...existing, { title: parsed.data.title.trim(), body: parsed.data.body.trim() }];
      const updated = await prisma.contract.update({ where: { id }, data: { customClauses: clauses as object, updatedBy: request.user!.id } });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "contract", entityId: id, newValues: { addedClause: parsed.data.title }, ipAddress: request.ip });
      return reply.code(201).send(updated);
    },
  );

  // Petit garde-fou partagé : un contrat signé/actif ne se modifie plus.
  const assertEditable = (contract: { status: string; _count: { signatures: number } }) =>
    !["active", "terminated", "expired"].includes(contract.status) && contract._count.signatures === 0;

  // §9 — Bibliothèque de MODÈLES de contrat : texte par défaut d'un article,
  // éditable sans toucher au code. Lecture (consultation) : la liste des textes
  // par défaut personnalisés, par type de document.
  fastify.get("/api/v1/contract-templates", { preHandler: requirePermission("contracts", "consultation") }, async (_request, reply) => {
    const rows = await prisma.contractClauseTemplate.findMany({ orderBy: [{ templateKey: "asc" }, { articleNumber: "asc" }] });
    return reply.send(rows.map((r) => ({ template_key: r.templateKey, article_number: r.articleNumber, body: r.body, updated_at: r.updatedAt })));
  });

  // Écriture (validation = autorité juridique / DG) : définir ou effacer le texte
  // par défaut d'un article d'un type de document. `body` vide = revenir au texte
  // standard (la ligne est supprimée). S'applique à TOUS les contrats à venir.
  fastify.put("/api/v1/contract-templates", { preHandler: requirePermission("contracts", "validation") }, async (request, reply) => {
    const parsed = z
      .object({ template_key: z.enum(["edition", "service", "auteur", "demi"]), article_number: z.number().int().min(1).max(15), body: z.string().max(8000) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
    const { template_key, article_number } = parsed.data;
    const body = parsed.data.body.trim();
    if (!body) {
      await prisma.contractClauseTemplate.deleteMany({ where: { templateKey: template_key, articleNumber: article_number } });
    } else {
      await prisma.contractClauseTemplate.upsert({
        where: { templateKey_articleNumber: { templateKey: template_key, articleNumber: article_number } },
        update: { body, updatedBy: request.user!.id },
        create: { templateKey: template_key, articleNumber: article_number, body, updatedBy: request.user!.id },
      });
    }
    await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "contract_template", entityId: `${template_key}:${article_number}`, newValues: { cleared: !body }, ipAddress: request.ip });
    return reply.send({ ok: true });
  });

  // Surcharger le TEXTE d'un article standard avant impression (ajuster un point).
  // `text` vide retire la surcharge (l'article revient au texte du modèle).
  // Possible tant que le contrat n'est pas signé.
  fastify.put(
    "/api/v1/contracts/:id/article-overrides",
    { preHandler: allowContractSaisie() },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ article: z.number().int().min(1).max(15), text: z.string().max(8000) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      const contract = await prisma.contract.findFirst({ where: { id, deletedAt: null }, include: { _count: { select: { signatures: true } } } });
      if (!contract) return reply.code(404).send({ code: "not_found", message: "Contrat introuvable." });
      if (!assertEditable(contract)) return reply.code(409).send({ code: "contract_signed", message: "Un contrat signé ou actif ne peut plus être modifié. Utilisez un avenant le cas échéant." });
      const map = contract.articleOverrides && typeof contract.articleOverrides === "object" && !Array.isArray(contract.articleOverrides)
        ? { ...(contract.articleOverrides as Record<string, string>) }
        : {};
      const key = String(parsed.data.article);
      const text = parsed.data.text.trim();
      if (text) map[key] = text; else delete map[key];
      const updated = await prisma.contract.update({ where: { id }, data: { articleOverrides: map as object, updatedBy: request.user!.id } });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "contract", entityId: id, newValues: { articleOverride: parsed.data.article, cleared: !text }, ipAddress: request.ip });
      return reply.send(updated);
    },
  );

  // Remplacer la LISTE des clauses additionnelles (permet modifier / retirer /
  // réordonner) — pas seulement ajouter. Contrat non signé.
  fastify.put(
    "/api/v1/contracts/:id/clauses",
    { preHandler: allowContractSaisie() },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ clauses: z.array(z.object({ title: z.string().min(2).max(200), body: z.string().min(2).max(8000) })).max(50) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      const contract = await prisma.contract.findFirst({ where: { id, deletedAt: null }, include: { _count: { select: { signatures: true } } } });
      if (!contract) return reply.code(404).send({ code: "not_found", message: "Contrat introuvable." });
      if (!assertEditable(contract)) return reply.code(409).send({ code: "contract_signed", message: "Un contrat signé ou actif ne peut plus être modifié. Utilisez un avenant le cas échéant." });
      const clauses = parsed.data.clauses.map((c) => ({ title: c.title.trim(), body: c.body.trim() }));
      const updated = await prisma.contract.update({ where: { id }, data: { customClauses: clauses as object, updatedBy: request.user!.id } });
      await writeAuditLog({ userId: request.user!.id, action: "update", entityType: "contract", entityId: id, newValues: { clausesReplaced: clauses.length }, ipAddress: request.ip });
      return reply.send(updated);
    },
  );

  // Suppression (logique) d'un contrat NON SIGNÉ — ex. un contrat de test.
  // Interdite dès qu'il porte une signature ou qu'il est actif/terminé/expiré :
  // un engagement signé ne se supprime pas (contrainte d'intégrité). Réservée à
  // la validation juridique, tracée au journal.
  fastify.delete(
    "/api/v1/contracts/:id",
    { preHandler: requirePermission("contracts", "validation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const contract = await prisma.contract.findFirst({
        where: { id, deletedAt: null },
        include: { _count: { select: { signatures: true } } },
      });
      if (!contract) return reply.code(404).send({ code: "not_found", message: "Contrat introuvable." });
      const locked = ["active", "terminated", "expired"].includes(contract.status);
      if (locked || contract._count.signatures > 0) {
        return reply.code(409).send({
          code: "contract_signed",
          message: "Un contrat signé ou actif ne peut être supprimé. Utilisez la résiliation le cas échéant.",
        });
      }
      await prisma.contract.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: request.user!.id } });
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "contract",
        entityId: id,
        oldValues: { status: contract.status, contractNumber: contract.contractNumber, deletedAt: null },
        newValues: { deletedAt: new Date().toISOString() },
        ipAddress: request.ip,
      });
      return reply.send({ deleted: true });
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
            // Date d'effet posée à l'activation : c'est elle qui, avec la durée,
            // détermine l'échéance et le préavis de non-reconduction.
            data: { status: "active", signedAt: contract.signedAt ?? signedAtDate, effectiveAt: contract.effectiveAt ?? signedAtDate, updatedBy: request.user!.id },
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

  // ── Pièces numérisées du contrat (Ch. 9 §9.9) ─────────────────────────────
  // Contrat physique signé scanné (PDF ou images) + annexes. Conservation des
  // originaux signés. Demande opérateur du 02/08/2026.

  async function contractExists(id: string): Promise<boolean> {
    const c = await prisma.contract.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    return Boolean(c);
  }

  // Liste des pièces d'un contrat.
  fastify.get(
    "/api/v1/contracts/:id/documents",
    { preHandler: requirePermission("contracts", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!(await contractExists(id))) return reply.code(404).send({ code: "not_found", message: "Contrat introuvable." });
      const docs = await prisma.contractDocument.findMany({
        where: { contractId: id, deletedAt: null },
        orderBy: { createdAt: "desc" },
      });
      const actorNames = await resolveActorNames(docs.map((d) => d.uploadedById));
      return reply.send(docs.map((d) => contractDocView(d, actorNames)));
    },
  );

  // Téléversement d'une pièce (multipart). Réservé à la saisie des contrats.
  fastify.post(
    "/api/v1/contracts/:id/documents",
    { preHandler: allowContractSaisie() },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!(await contractExists(id))) return reply.code(404).send({ code: "not_found", message: "Contrat introuvable." });
      const upload = await readContractUpload(request);
      if (!upload) return reply.code(400).send({ code: "validation_error", message: "Aucun fichier reçu." });
      const stored = await storeFile(upload.buf, upload.name);
      const created = await prisma.contractDocument.create({
        data: {
          contractId: id,
          kind: upload.kind,
          label: upload.label,
          fileName: upload.name,
          filePath: stored.filePath,
          fileMime: upload.mime,
          fileSize: stored.fileSize,
          uploadedById: request.user!.id,
        },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "contract_document",
        entityId: created.id,
        newValues: { contractId: id, kind: upload.kind, fileName: upload.name },
        ipAddress: request.ip,
      });
      const actorNames = await resolveActorNames([created.uploadedById]);
      return reply.code(201).send(contractDocView(created, actorNames));
    },
  );

  // Téléchargement d'une pièce.
  fastify.get(
    "/api/v1/contracts/:id/documents/:docId/download",
    { preHandler: requirePermission("contracts", "consultation") },
    async (request, reply) => {
      const { id, docId } = request.params as { id: string; docId: string };
      const doc = await prisma.contractDocument.findFirst({ where: { id: docId, contractId: id, deletedAt: null } });
      if (!doc) return reply.code(404).send({ code: "not_found", message: "Pièce introuvable." });
      const buffer = await readStoredFile(doc.filePath);
      reply.header("content-type", doc.fileMime);
      reply.header("content-disposition", `attachment; filename="${doc.fileName.replace(/"/g, "")}"`);
      return reply.send(buffer);
    },
  );

  // Retrait logique d'une pièce (conservation : suppression logique uniquement).
  fastify.delete(
    "/api/v1/contracts/:id/documents/:docId",
    { preHandler: allowContractSaisie() },
    async (request, reply) => {
      const { id, docId } = request.params as { id: string; docId: string };
      const doc = await prisma.contractDocument.findFirst({ where: { id: docId, contractId: id, deletedAt: null } });
      if (!doc) return reply.code(404).send({ code: "not_found", message: "Pièce introuvable." });
      await prisma.contractDocument.update({ where: { id: docId }, data: { deletedAt: new Date(), deletedBy: request.user!.id } });
      await writeAuditLog({
        userId: request.user!.id,
        action: "update",
        entityType: "contract_document",
        entityId: docId,
        oldValues: { fileName: doc.fileName },
        newValues: { deleted: true },
        ipAddress: request.ip,
      });
      return reply.send({ ok: true });
    },
  );

  // Journal d'envoi du contrat — trace des transmissions à l'auteur (messagerie
  // interne / WhatsApp). Consultation ouverte à qui peut voir les contrats.
  fastify.get(
    "/api/v1/contracts/:id/dispatches",
    { preHandler: requirePermission("contracts", "consultation") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!(await contractExists(id))) return reply.code(404).send({ code: "not_found", message: "Contrat introuvable." });
      const rows = await prisma.contractDispatch.findMany({ where: { contractId: id }, orderBy: { sentAt: "desc" } });
      const actorNames = await resolveActorNames(rows.map((r) => r.sentById));
      return reply.send(rows.map((r) => dispatchView(r, actorNames)));
    },
  );

  // Enregistrement d'un envoi (append-only : on n'efface jamais une trace). Le
  // transfert lui-même (pièce jointe / ouverture WhatsApp) se fait côté client ;
  // cette route ne fait qu'inscrire au registre que l'envoi a eu lieu.
  fastify.post(
    "/api/v1/contracts/:id/dispatches",
    { preHandler: allowContractSaisie() },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!(await contractExists(id))) return reply.code(404).send({ code: "not_found", message: "Contrat introuvable." });
      const parsed = createDispatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: "validation_error", message: "Champs invalides.", details: parsed.error.issues });
      }
      const created = await prisma.contractDispatch.create({
        data: {
          contractId: id,
          channel: parsed.data.channel,
          documentLabel: parsed.data.document_label?.trim() ?? "",
          recipient: parsed.data.recipient?.trim() ?? "",
          note: parsed.data.note?.trim() ?? "",
          sentById: request.user!.id,
        },
      });
      await writeAuditLog({
        userId: request.user!.id,
        action: "create",
        entityType: "contract_dispatch",
        entityId: created.id,
        newValues: { contractId: id, channel: created.channel, recipient: created.recipient, documentLabel: created.documentLabel },
        ipAddress: request.ip,
      });
      const actorNames = await resolveActorNames([created.sentById]);
      return reply.code(201).send(dispatchView(created, actorNames));
    },
  );
}

const createDispatchSchema = z.object({
  channel: z.nativeEnum(ContractDispatchChannel),
  document_label: z.string().max(200).optional(),
  recipient: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
});

// Vue lisible d'un envoi (avec le nom de l'expéditeur).
function dispatchView(
  r: { id: string; contractId: string; channel: ContractDispatchChannel; documentLabel: string; recipient: string; note: string; sentAt: Date; sentById: string | null },
  actorNames: Map<string, string>,
) {
  return {
    id: r.id,
    contract_id: r.contractId,
    channel: r.channel,
    document_label: r.documentLabel,
    recipient: r.recipient,
    note: r.note,
    sent_at: r.sentAt,
    sent_by_name: r.sentById ? actorNames.get(r.sentById) ?? null : null,
  };
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
