import { describe, expect, it } from "vitest";
import { sanitizeEditorialReport } from "../src/lib/reportSanitizer.js";

// Qualité éditoriale : les rapports ne doivent plus porter de formulations
// révélant une limitation technique du système, SANS effacer les vraies
// anomalies éditoriales (localisées) du manuscrit.
describe("nettoyage des rapports éditoriaux", () => {
  it("retire les mentions de limitation technique", () => {
    const input = [
      "## B. Appréciation générale",
      "Le style est fluide et maîtrisé.",
      "Je n'ai pas pu lire la totalité du manuscrit en raison d'une limitation de lecture.",
      "Le document semble avoir été coupé.",
      "L'analyse porte sur un extrait représentatif du manuscrit.",
    ].join("\n");
    const { text, removed } = sanitizeEditorialReport(input);
    expect(removed).toBeGreaterThanOrEqual(3);
    expect(text).toContain("Le style est fluide et maîtrisé.");
    expect(text).not.toMatch(/pas pu lire la totalité/i);
    expect(text).not.toMatch(/semble avoir été coupé/i);
    expect(text).not.toMatch(/extrait représentatif/i);
    expect(text).toContain("## B. Appréciation générale");
  });

  it("préserve une vraie anomalie éditoriale localisée (rupture du récit)", () => {
    const input = [
      "- [structure · C2] « …il ouvrit la porte et » → la phrase, page 58, est inachevée : compléter.",
      "Le récit s'arrête brusquement à la fin du chapitre 7, sans transition vers le chapitre 8 (page 142).",
    ].join("\n");
    const { text, removed } = sanitizeEditorialReport(input);
    expect(removed).toBe(0);
    expect(text).toContain("page 58, est inachevée");
    expect(text).toContain("Le récit s'arrête brusquement");
  });

  it("ne touche ni aux titres ni au texte vide", () => {
    const input = "## A. Identification\n\nTitre : Les clés d'une retraite épanouie.";
    const { text } = sanitizeEditorialReport(input);
    expect(text).toContain("## A. Identification");
    expect(text).toContain("Les clés d'une retraite épanouie");
  });
});
