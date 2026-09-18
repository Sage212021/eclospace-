import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { buildCorrectionMethodText, effectiveControlPoints } from "../src/lib/correctionProfile.js";

// Lot 2 — la méthode s'adapte à CHAQUE type d'ouvrage et à CHAQUE relecture,
// et les gabarits de rapport portent les colonnes/statuts officiels (§9, §10,
// §6). Tests déterministes (sans appel IA) : grilles par type + format des
// rapports seedés.

describe("Moteur de correction — matrice type × relecture (Lot 2)", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  // Chaque type doit charger une grille non vide, dont un point « signature ».
  const matrix: { code: string; signature: RegExp }[] = [
    { code: "roman", signature: /personnages|narrati/i },
    { code: "essai", signature: /argumentati|problématique/i },
    { code: "scientifique", signature: /terminologie scientifique|équations|figures/i },
    { code: "jeunesse", signature: /âge cible|texte \/ image/i },
    { code: "enfant", signature: /image|pagination|gabarit/i },
    { code: "theatre", signature: /didascalies|répliques|scènes/i },
    { code: "poesie", signature: /vers|strophes|rupture volontaire/i },
    { code: "politique", signature: /personnalités|institutions|source/i },
    { code: "manuel", signature: /exercice|corrigés|consignes/i },
  ];

  for (const { code, signature } of matrix) {
    it(`${code} R1 : grille propre chargée, sévérités et fiabilité présentes`, async () => {
      const points = await effectiveControlPoints(code);
      expect(points.length).toBeGreaterThan(0);
      const txt = await buildCorrectionMethodText({ bookTypeCode: code, bookTypeLabel: code, support: "manuscrit_interieur", relecture: 1 });
      expect(txt).toMatch(signature);
      expect(txt).toContain("Relecture 1");
      expect(txt).toContain("C1 (BLOQUANT");
      expect(txt).toContain("ne jamais inventer");
    });
  }

  it("Roman R2 : le bloc méthode bascule bien en « Relecture 2 »", async () => {
    const txt = await buildCorrectionMethodText({ bookTypeCode: "roman", bookTypeLabel: "Roman", support: "version_corrigee", relecture: 2 });
    expect(txt).toContain("Relecture 2");
    expect(txt).toMatch(/personnages|narrati/i);
  });
});

describe("Gabarits de rapport — colonnes & statuts officiels (Lot 2)", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  const guidanceOf = async (workType: string) => {
    const p = await prisma.aiPrompt.findUnique({ where: { workType: workType as never } });
    const tpl = p?.reportTemplate as { guidance?: string; sections?: { title: string }[] } | null;
    return (tpl?.guidance ?? "") + " " + (tpl?.sections ?? []).map((s) => s.title).join(" ");
  };

  it("BAT1 : tableau d'annotations avec Sévérité, Justification et Statut", async () => {
    const g = await guidanceOf("correction_1");
    expect(g).toContain("Justification");
    expect(g).toContain("Statut");
    expect(g).toMatch(/Sévérité/);
  });

  it("BAT2 : suivi R1 avec les 5 statuts officiels", async () => {
    const g = await guidanceOf("correction_2");
    for (const s of ["CORRIGÉE", "NON CORRIGÉE", "PARTIELLEMENT CORRIGÉE", "CORRECTION MODIFIÉE", "NOUVELLE ANOMALIE"]) {
      expect(g).toContain(s);
    }
  });

  it("Couverture : tableau d'annotations par FACE (1ère / dos / 4ème)", async () => {
    const g = await guidanceOf("couverture");
    expect(g).toMatch(/Face/);
    expect(g).toContain("1ʳᵉ de couverture");
    expect(g).toContain("dos");
    expect(g).toContain("4ᵉ de couverture");
  });
});
