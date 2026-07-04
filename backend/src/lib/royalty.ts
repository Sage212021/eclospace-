import { prisma } from "./prisma.js";
import { notifyRole } from "./notify.js";
import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

interface RoyaltyTier {
  up_to: number | null;
  rate: number;
}

function rateForCumulativeQuantity(tiers: RoyaltyTier[], cumulativeQuantity: number): number {
  for (const tier of tiers) {
    if (tier.up_to === null || cumulativeQuantity <= tier.up_to) return tier.rate;
  }
  return tiers.length > 0 ? tiers[tiers.length - 1].rate : 0;
}

async function findActiveRoyaltyContract(tx: Tx, manuscriptId: string) {
  return tx.contract.findFirst({
    where: {
      manuscriptId,
      status: "active",
      type: { in: ["edition", "coedition"] },
      deletedAt: null,
      royaltyTerms: { isNot: null },
    },
    include: { royaltyTerms: true },
  });
}

// Ch. 9 §9.5 : dès qu'une vente (ou un retour) est enregistrée, le relevé de
// droits de l'auteur est mis à jour selon les clauses de son contrat —
// pourcentage, paliers progressifs, assiette (prix public HT / prix net
// éditeur). Une ligne par mouvement générateur, tout est recalculable et
// traçable (§9.5) ; les entrées déjà rattachées à un relevé émis déclenchent
// une alerte au service financier plutôt qu'une modification rétroactive du
// relevé (immuabilité des documents financiers déjà émis, cf. factures §18.2).
export async function recordRoyaltyEntry(
  tx: Tx,
  params: {
    manuscriptId: string;
    quantity: number; // signé : négatif pour un retour
    unitPublicPrice: number;
    unitNetPrice: number;
    sourceType: string;
    sourceId: string;
  },
): Promise<void> {
  const contract = await findActiveRoyaltyContract(tx, params.manuscriptId);
  if (!contract || !contract.royaltyTerms) return; // pas de contrat de droits actif : rien à calculer

  const priorSum = await tx.royaltyEntry.aggregate({
    where: { contractId: contract.id },
    _sum: { quantity: true },
  });
  const cumulativeBefore = priorSum._sum.quantity ?? 0;
  const cumulativeAfter = cumulativeBefore + params.quantity;

  const tiers = contract.royaltyTerms.tiers as unknown as RoyaltyTier[];
  // Simplification documentée (docs/JOURNAL_TECHNIQUE.md) : le palier atteint
  // après ce mouvement s'applique à sa totalité, plutôt qu'une répartition
  // au prorata lorsqu'un mouvement chevauche deux paliers.
  const rate = rateForCumulativeQuantity(tiers, cumulativeAfter);
  const unitBaseAmount = contract.royaltyTerms.base === "prix_public_ht" ? params.unitPublicPrice : params.unitNetPrice;
  const amount = Math.round(params.quantity * unitBaseAmount * rate * 100) / 100;

  await tx.royaltyEntry.create({
    data: {
      contractId: contract.id,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      quantity: params.quantity,
      unitBaseAmount,
      rateApplied: rate,
      amount,
    },
  });

  if (params.quantity < 0) {
    const issuedStatement = await tx.royaltyStatement.findFirst({
      where: { contractId: contract.id, status: { in: ["issued", "paid"] } },
      orderBy: { periodEnd: "desc" },
    });
    if (issuedStatement) {
      await notifyRole({
        roleCode: "RESP_FINANCE",
        type: "autre",
        priority: "high",
        title: "Retour tardif après émission d'un relevé de droits",
        body: `Un retour affecte le contrat ${contract.contractNumber} après l'émission du relevé du ${issuedStatement.periodStart.toISOString().slice(0, 10)} au ${issuedStatement.periodEnd.toISOString().slice(0, 10)} — recalcul à examiner.`,
        entityType: "royalty_statement",
        entityId: issuedStatement.id,
      });
    }
  }
}
