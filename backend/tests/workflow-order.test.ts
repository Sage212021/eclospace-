import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";

// Ordre de référence du workflow de production du manuscrit (D-010, 18/08/2026) :
// la « Contractualisation » doit venir IMMÉDIATEMENT après la « Validation du
// BAT ». La table workflow_statuses (semée par prisma/seed.ts) est la source de
// vérité unique : la frise, les tableaux de bord, les transitions et les filtres
// lisent tous son stepOrder. Ce test verrouille l'ordre pour éviter toute
// régression et toute redéfinition divergente ailleurs dans l'ERP.

describe("ordre de référence du workflow (D-010)", () => {
  beforeAll(async () => {
    // La base de test est semée par le script pretest ; rien à faire ici.
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("« Contractualisation » existe et vient juste après « Validation du BAT »", async () => {
    const bat = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "VALIDATION_BAT" } });
    const contract = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "CONTRACTUALISATION" } });
    expect(bat).toBeTruthy();
    expect(contract).toBeTruthy();
    // Immédiatement après = stepOrder consécutif.
    expect(contract.stepOrder).toBe(bat.stepOrder + 1);
  });

  it("« Contractualisation » précède « Impression »", async () => {
    const contract = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "CONTRACTUALISATION" } });
    const print = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "IMPRESSION" } });
    expect(contract.stepOrder).toBeLessThan(print.stepOrder);
  });

  it("la « Décision éditoriale » n'est plus immédiatement suivie de la contractualisation (mais de la planification)", async () => {
    const decision = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "DECISION_EDITORIALE" } });
    const planning = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "PLANIFICATION" } });
    expect(planning.stepOrder).toBe(decision.stepOrder + 1);
  });

  it("l'Expertise et la Réécriture précèdent la Correction éditoriale (D-014)", async () => {
    const all = await prisma.workflowStatus.findMany({ orderBy: { stepOrder: "asc" } });
    const codesByOrder = all.map((s) => s.code);
    const planIdx = codesByOrder.indexOf("PLANIFICATION");
    // Planification → Expertise → Réécriture → Correction → Mise en page.
    expect(codesByOrder.slice(planIdx, planIdx + 5)).toEqual([
      "PLANIFICATION", "EXPERTISE", "REECRITURE", "CORRECTION", "MISE_EN_PAGE",
    ]);
  });

  it("l'ordre reste contigu de 1 à 20, sans doublon de stepOrder", async () => {
    const all = await prisma.workflowStatus.findMany({ orderBy: { stepOrder: "asc" } });
    const orders = all.map((s) => s.stepOrder);
    // Aucun doublon.
    expect(new Set(orders).size).toBe(orders.length);
    // Contigu de 1 à N.
    expect(orders).toEqual(Array.from({ length: orders.length }, (_, i) => i + 1));
    // Séquence exacte attendue autour du bloc réordonné.
    const codesByOrder = all.map((s) => s.code);
    const batIdx = codesByOrder.indexOf("VALIDATION_BAT");
    expect(codesByOrder.slice(batIdx, batIdx + 3)).toEqual(["VALIDATION_BAT", "CONTRACTUALISATION", "IMPRESSION"]);
  });
});
