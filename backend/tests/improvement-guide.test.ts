import { describe, expect, it } from "vitest";
import { generateImprovementGuide, GUIDE_CATEGORY, GUIDE_TITLE } from "../src/lib/improvementGuide.js";
import { readFileSync } from "node:fs";

// Guide éditorial d'amélioration (collaboration Évaluation → SAGE), Phase 1.
// On vérifie la FIDÉLITÉ de la consigne (structure + règles) sans appeler l'API.
describe("guide éditorial d'amélioration (SAGE)", () => {
  it("catégorie GED et titre conformes", () => {
    expect(GUIDE_CATEGORY).toBe("guide_amelioration");
    expect(GUIDE_TITLE).toContain("GUIDE ÉDITORIAL D'AMÉLIORATION");
  });

  it("ne génère rien (null) sans rapport d'évaluation — aucun appel réseau", async () => {
    const r = await generateImprovementGuide({ manuscriptId: "00000000-0000-0000-0000-000000000000", reportText: "   " });
    expect(r).toBeNull();
  });

  it("la consigne de SAGE impose les 8 rubriques, les identifiants EVAL-xxx et interdit la mention « IA »", () => {
    const src = readFileSync(new URL("../src/lib/improvementGuide.ts", import.meta.url), "utf8");
    for (const n of ["## 1.", "## 2.", "## 3.", "## 4.", "## 5.", "## 6.", "## 7.", "## 8."]) {
      expect(src).toContain(n);
    }
    expect(src).toContain("EVAL-001");
    expect(src).toMatch(/intelligence artificielle/i); // la règle « jamais de mention IA » est présente
    expect(src).toContain("manuscrit INTÉGRAL");
    expect(src).toMatch(/à vérifier par le comité/i); // contrôle de cohérence (désaccord possible)
  });
});
