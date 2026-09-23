import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { resolveAiSourceVersion } from "../src/lib/aiRunner.js";

// Cohérence du circuit de correction : l'IA doit lire la BONNE matière à chaque
// passage — BAT1 = manuscrit à corriger ; BAT2 = version INTÉGRÉE du 1er passage
// (rendu de l'intégrateur), jamais l'original ; couverture = couvertures VC1.

describe("Source IA selon le passage de correction", () => {
  let adminId: string;
  let manuscriptId: string;
  const s = Math.random().toString(36).slice(2, 7);

  // Dépose un document + version avec un filePath distinctif (pour l'assertion).
  const deposit = async (opts: { category: string; title: string; tag: string }) => {
    const doc = await prisma.document.create({
      data: { entityType: "manuscript", entityId: manuscriptId, category: opts.category as never, title: opts.title, createdBy: adminId, updatedBy: adminId },
    });
    await prisma.documentVersion.create({
      data: { documentId: doc.id, versionNumber: 1, filePath: `test/${opts.tag}-${s}.txt`, fileSize: 10, mimeType: "text/plain", sha256Hash: "0".repeat(64), changeSummary: opts.tag, uploadedBy: adminId },
    });
    return doc.id;
  };
  const tagOf = async (workType: string) => {
    const v = await resolveAiSourceVersion(manuscriptId, workType);
    return v?.filePath.replace(`test/`, "").replace(`-${s}.txt`, "") ?? null;
  };

  beforeAll(async () => {
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const st = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "CORRECTION" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-SRC-${s}`, title: `Source ${s}`, language: "fr", statusId: st.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId },
    });
    manuscriptId = m.id;
  });

  afterAll(async () => {
    await prisma.manuscript.deleteMany({ where: { id: manuscriptId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("BAT1 lit le manuscrit d'origine à défaut de VC1, puis le manuscrit à corriger (VC1)", async () => {
    await deposit({ category: "manuscrit", title: "Manuscrit (source)", tag: "orig" });
    expect(await tagOf("correction_1")).toBe("orig");

    await deposit({ category: "piece_etape", title: "[vc1:manuscrit] a_corriger.txt", tag: "vc1manu" });
    expect(await tagOf("correction_1")).toBe("vc1manu");
  });

  it("BAT2 lit la version INTÉGRÉE du 1er passage, pas l'original", async () => {
    // Avant intégration : repli sur le manuscrit à corriger (VC1).
    expect(await tagOf("correction_2")).toBe("vc1manu");

    // L'intégrateur dépose la version intégrée du 1er passage.
    await deposit({ category: "piece_etape", title: "[correction:integration_1] bat1_integre.txt", tag: "integ1" });
    expect(await tagOf("correction_2")).toBe("integ1");
    // BAT1 continue de lire le manuscrit à corriger (inchangé).
    expect(await tagOf("correction_1")).toBe("vc1manu");
  });

  it("Couverture lit en priorité les couvertures à corriger (VC1)", async () => {
    await deposit({ category: "piece_etape", title: "[vc1:couvertures] couv_1ere_dos_4eme.txt", tag: "vc1couv" });
    expect(await tagOf("couverture")).toBe("vc1couv");
  });

  it("Couverture BAT2 lit le RETOUR d'intégration infographie, pas les couvertures VC1", async () => {
    // Avant retour infographe : BAT2 se replie sur les couvertures VC1.
    const before = await resolveAiSourceVersion(manuscriptId, "couverture", "BAT2");
    expect(before?.filePath.includes("vc1couv")).toBe(true);

    // L'infographe dépose son retour d'intégration (couverture intégrée, BAT2).
    await deposit({ category: "piece_etape", title: "[correction:couverture_integration_1] couv_integree.txt", tag: "covinteg1" });
    const after = await resolveAiSourceVersion(manuscriptId, "couverture", "BAT2");
    expect(after?.filePath.includes("covinteg1")).toBe(true);

    // BAT1 continue de lire les couvertures VC1 (inchangé).
    const bat1 = await resolveAiSourceVersion(manuscriptId, "couverture", "BAT1");
    expect(bat1?.filePath.includes("vc1couv")).toBe(true);
  });
});
