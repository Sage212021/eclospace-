import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { generateYearEndStatements } from "../src/lib/royaltyYearEnd.js";

// Génération automatique des états annuels de droits d'auteur : sur une année
// civile pleine, un relevé par contrat ayant des droits non encore relevés.
// Idempotent (anti-chevauchement) et dissocié par année. Années isolées (2042,
// 2043) pour ne pas heurter les autres jeux de données.

const rnd = () => Math.random().toString(36).slice(2, 8);

describe("génération de fin d'année des états de droits d'auteur", () => {
  let app: FastifyInstance;
  let partnerId: string;
  let contractId: string;

  beforeAll(async () => {
    app = await buildApp();
    const partner = await prisma.partner.create({ data: { firstName: "Bea", lastName: `Kamga-${rnd()}`, category: "auteur" } });
    partnerId = partner.id;
    const contract = await prisma.contract.create({
      data: { contractNumber: `CT-YE-${rnd()}`, type: "edition", partnerId, financialTerms: {}, status: "active" },
    });
    contractId = contract.id;
    await prisma.royaltyTerms.create({
      data: { contractId, base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.1 }], taxWithholdingPct: "5.00" },
    });
    // Droits acquis 2042 : 60 000. Droits acquis 2043 : 20 000 (années dissociées).
    await prisma.royaltyEntry.create({
      data: { contractId, sourceType: "pos_sale", sourceId: rnd(), quantity: 100, unitBaseAmount: "6000.00", rateApplied: "0.1000", amount: "60000.00", computedAt: new Date(Date.UTC(2042, 5, 10)) },
    });
    await prisma.royaltyEntry.create({
      data: { contractId, sourceType: "pos_sale", sourceId: rnd(), quantity: 40, unitBaseAmount: "5000.00", rateApplied: "0.1000", amount: "20000.00", computedAt: new Date(Date.UTC(2043, 5, 10)) },
    });
  });

  afterAll(async () => {
    await prisma.royaltyEntry.deleteMany({ where: { contractId } });
    await prisma.royaltyStatement.deleteMany({ where: { contractId } });
    await prisma.royaltyTerms.deleteMany({ where: { contractId } });
    await prisma.contract.delete({ where: { id: contractId } });
    await prisma.partner.delete({ where: { id: partnerId } });
    await app.close();
  });

  it("génère un relevé annuel couvrant l'année, rattache les droits", async () => {
    const created = await generateYearEndStatements(2042, null);
    expect(created).toBeGreaterThanOrEqual(1);
    const statements = await prisma.royaltyStatement.findMany({ where: { contractId } });
    const st2042 = statements.find((s) => s.periodStart.getUTCFullYear() === 2042);
    expect(st2042).toBeTruthy();
    expect(Number(st2042!.totalEarned)).toBe(60000);
    // L'écriture 2042 est désormais rattachée à un relevé.
    const entry2042 = await prisma.royaltyEntry.findFirst({ where: { contractId, computedAt: { gte: new Date(Date.UTC(2042, 0, 1)), lt: new Date(Date.UTC(2043, 0, 1)) } } });
    expect(entry2042!.statementId).toBe(st2042!.id);
  });

  it("idempotent : relancer la même année ne crée pas de doublon", async () => {
    const before = await prisma.royaltyStatement.count({ where: { contractId } });
    const created = await generateYearEndStatements(2042, null);
    expect(created).toBe(0);
    const after = await prisma.royaltyStatement.count({ where: { contractId } });
    expect(after).toBe(before);
  });

  it("dissociation par année : 2043 produit son propre relevé, distinct de 2042", async () => {
    const created = await generateYearEndStatements(2043, null);
    expect(created).toBe(1);
    const statements = await prisma.royaltyStatement.findMany({ where: { contractId }, orderBy: { periodStart: "asc" } });
    const years = statements.map((s) => s.periodStart.getUTCFullYear());
    expect(years).toContain(2042);
    expect(years).toContain(2043);
    const st2043 = statements.find((s) => s.periodStart.getUTCFullYear() === 2043);
    expect(Number(st2043!.totalEarned)).toBe(20000);
  });
});
