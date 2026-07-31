import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { recordRoyaltyEntry } from "../src/lib/royalty.js";

// F1 — assiette des droits d'auteur et remise commerciale (Ch. 9 §9.5).
// Une remise consentie au libraire ne doit PAS réduire les droits d'un contrat
// « prix public HT » : l'assiette reste le prix public (avant remise). Un
// contrat « prix net éditeur » se calcule, lui, sur le prix effectivement
// facturé (après remise).

const rnd = () => Math.random().toString(36).slice(2, 8);

describe("assiette des droits d'auteur face à une remise", () => {
  let manuscriptId: string;
  let publicContractId: string;
  let netContractId: string;

  beforeAll(async () => {
    const status = await prisma.workflowStatus.findFirstOrThrow({ orderBy: { stepOrder: "asc" } });
    const owner = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const partner = await prisma.partner.create({ data: { firstName: "Ada", lastName: `Kongo-${rnd()}`, category: "auteur" } });

    const manuscript = await prisma.manuscript.create({
      data: {
        manuscriptNumber: `MS-ROY-${rnd()}`,
        title: "Assiette et remise",
        language: "fr",
        statusId: status.id,
        ownerId: owner.id,
        receivedAt: new Date(),
      },
    });
    manuscriptId = manuscript.id;

    // Deux contrats actifs, distingués par le format vendu : l'un au prix
    // public HT (broché), l'autre au prix net éditeur (numérique).
    const pub = await prisma.contract.create({
      data: {
        contractNumber: `CT-PUB-${rnd()}`,
        type: "edition",
        manuscriptId,
        partnerId: partner.id,
        formats: ["broché"],
        financialTerms: {},
        status: "active",
        royaltyTerms: { create: { base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.1 }] } },
      },
    });
    publicContractId = pub.id;

    const net = await prisma.contract.create({
      data: {
        contractNumber: `CT-NET-${rnd()}`,
        type: "edition",
        manuscriptId,
        partnerId: partner.id,
        formats: ["numérique"],
        financialTerms: {},
        status: "active",
        royaltyTerms: { create: { base: "prix_net_editeur", tiers: [{ up_to: null, rate: 0.1 }] } },
      },
    });
    netContractId = net.id;
  });

  afterAll(async () => {
    await prisma.royaltyEntry.deleteMany({ where: { contractId: { in: [publicContractId, netContractId] } } });
    await prisma.royaltyTerms.deleteMany({ where: { contractId: { in: [publicContractId, netContractId] } } });
    const partnerIds = (await prisma.contract.findMany({ where: { id: { in: [publicContractId, netContractId] } }, select: { partnerId: true } })).map((c) => c.partnerId);
    await prisma.contract.deleteMany({ where: { id: { in: [publicContractId, netContractId] } } });
    await prisma.manuscript.delete({ where: { id: manuscriptId } });
    await prisma.partner.deleteMany({ where: { id: { in: partnerIds } } });
  });

  it("contrat « prix public HT » : la remise ne réduit pas les droits (assiette = prix public)", async () => {
    // 10 exemplaires, prix public 10 000, remise 20 % → net facturé 8 000.
    await recordRoyaltyEntry(prisma, {
      manuscriptId,
      format: "broché",
      quantity: 10,
      unitPublicPrice: 10000,
      unitNetPrice: 8000,
      sourceType: "test_sale",
      sourceId: rnd(),
    });
    const entry = await prisma.royaltyEntry.findFirstOrThrow({ where: { contractId: publicContractId }, orderBy: { computedAt: "desc" } });
    // Assiette = prix public (10 000), pas le net remisé (8 000).
    expect(Number(entry.unitBaseAmount)).toBe(10000);
    // Droits = 10 × 10 000 × 10 % = 10 000 (et non 8 000 sur le net).
    expect(Number(entry.amount)).toBe(10000);
  });

  it("contrat « prix net éditeur » : l'assiette est bien le prix net facturé", async () => {
    await recordRoyaltyEntry(prisma, {
      manuscriptId,
      format: "numérique",
      quantity: 10,
      unitPublicPrice: 10000,
      unitNetPrice: 8000,
      sourceType: "test_sale",
      sourceId: rnd(),
    });
    const entry = await prisma.royaltyEntry.findFirstOrThrow({ where: { contractId: netContractId }, orderBy: { computedAt: "desc" } });
    expect(Number(entry.unitBaseAmount)).toBe(8000);
    expect(Number(entry.amount)).toBe(8000); // 10 × 8 000 × 10 %
  });
});
