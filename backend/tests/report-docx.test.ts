import { describe, expect, it } from "vitest";
import { renderReportDocx, extractDocxXml } from "../src/lib/aiRunner.js";

// Lisibilité des fichiers Word générés (demande opérateur 18/11/2026) : le tableau
// d'annotations s'affichait VIDE / masqué dans certains lecteurs (mobiles, Google,
// LibreOffice). Cause : tableau large SANS largeurs de colonnes + largeur de table
// « 100% » (valeur non numérique lue comme 0). Ici on vérifie que le .docx généré
// porte de VRAIES largeurs et le contenu des cellules.

const REPORT = `# Rapport de relecture BAT1

## 3. Annotations de correction

| N° | Sévérité | Page/emplacement | Élément (texte original) | Constat | Correction proposée | Justification | Statut |
|----|----------|------------------|--------------------------|---------|---------------------|---------------|--------|
| 1 | C2 | Avant-propos, p.19 | « il referma la porte doucement » | Accord | « il referma la porte » | RAS | À corriger |
| 2 | C1 | Chapitre 11, p.42 | « les tensions familiales se dénouèrent » | Répétition | reformuler | évite la lourdeur | À corriger |
`;

describe("Lisibilité du .docx de rapport (tableau d'annotations)", () => {
  it("le tableau large porte de VRAIES largeurs (grille + cellules), jamais « 100% », et contient le texte", async () => {
    const buf = await renderReportDocx("Rapport de relecture", REPORT, { entete: true });
    const xml = extractDocxXml(buf);
    expect(xml).toBeTruthy();
    const x = xml!;

    // Jamais de largeur en pourcentage non numérique (cause du tableau vide).
    expect(x).not.toContain('w:w="100%"');
    // Largeur de table VALIDE en DXA.
    expect(/<w:tblW w:type="dxa" w:w="\d+"\/>/.test(x)).toBe(true);
    // Grille de colonnes explicite (8 colonnes) + cellules avec largeur.
    expect((x.match(/<w:gridCol /g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect((x.match(/<w:tcW /g) ?? []).length).toBeGreaterThanOrEqual(8);
    // Mise en page fixe (largeurs respectées par tous les lecteurs).
    expect(x).toContain('<w:tblLayout w:type="fixed"/>');
    // Le CONTENU des annotations est bien présent dans le tableau.
    expect(x).toContain("tensions familiales");
    expect(x).toContain("Répétition");
    expect(x).toContain("À corriger");
  });
});
