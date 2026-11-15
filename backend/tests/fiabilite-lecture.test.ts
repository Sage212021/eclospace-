import { describe, expect, it } from "vitest";
import { Document, Packer, Paragraph, TextRun, Tab, Table, TableRow, TableCell } from "docx";
import { isReadingCoverageComplete, prepareVisualOrText, decodeXmlEntities, normalizeText } from "../src/lib/aiRunner.js";
import { segmentText } from "../src/lib/correctionSweep.js";
import { extractUploadAttachment } from "../src/lib/aiAssistant.js";

// Fiabilité de lecture (cahier des charges opérateur) — tests sans appel IA :
// couverture intégrale (blocage si incomplète), segmentation ordonnée, et
// extraction réelle d'un DOCX (paragraphes + tableau).
describe("fiabilité de lecture des manuscrits", () => {
  it("couverture : complète seulement si TOUS les segments sont analysés", () => {
    expect(isReadingCoverageComplete(3, 3)).toBe(true);
    expect(isReadingCoverageComplete(2, 3)).toBe(false); // un segment manquant → bloquant
    expect(isReadingCoverageComplete(0, 0)).toBe(true); // rien à couvrir
  });

  it("segmentation : tout le texte est couvert, dans l'ordre", () => {
    const text = Array.from({ length: 12 }, (_, i) => `Bloc ${i} ` + "y".repeat(4000)).join("\n\n");
    const segs = segmentText(text, 10000);
    expect(segs.length).toBeGreaterThan(1);
    for (let i = 0; i < 12; i++) expect(segs.some((s) => s.includes(`Bloc ${i} `))).toBe(true);
  });

  it("extraction DOCX réelle : paragraphes ET tableau sont lus", async () => {
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ children: [new TextRun("Chapitre premier : ouverture du manuscrit.")] }),
          new Paragraph("Deuxième paragraphe avec un contenu distinct."),
          new Table({ rows: [new TableRow({ children: [
            new TableCell({ children: [new Paragraph("CelluleGauche")] }),
            new TableCell({ children: [new Paragraph("CelluleDroite")] }),
          ] })] }),
        ],
      }],
    });
    const buf = await Packer.toBuffer(doc);
    const att = await extractUploadAttachment(Buffer.from(buf), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "manuscrit.docx");
    expect(att.lu).toBe(true);
    expect(att.text).toContain("Chapitre premier");
    expect(att.text).toContain("Deuxième paragraphe");
    expect(att.text).toContain("CelluleGauche");
    expect(att.text).toContain("CelluleDroite");
  });

  it("extraction .docx : AUCUN résidu de balise Word ne doit atteindre le relecteur (tableaux + tabulations)", async () => {
    // Reproduit le défaut « scandale » : un document avec TABLEAU (bordures,
    // largeurs de colonnes) et TABULATIONS faisait fuiter des <w:tab>, <w:tcPr>…
    // dans le texte lu par l'IA. Ici on vérifie que le texte extrait est PROPRE.
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ children: [new TextRun("Chapitre 1"), new Tab(), new TextRun("Page")] }),
          new Paragraph({ children: [new TextRun("Avant"), new Tab(), new TextRun("Après")] }),
          new Paragraph("Droits & responsabilités : « encadrer » sans céder."),
          new Table({ rows: [new TableRow({ children: [
            new TableCell({ children: [new Paragraph("CelluleGauche")] }),
            new TableCell({ children: [new Paragraph("CelluleDroite")] }),
          ] })] }),
        ],
      }],
    });
    const buf = await Packer.toBuffer(doc);
    const prepared = await prepareVisualOrText("application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.from(buf));
    expect(prepared.kind).toBe("text");
    const text = prepared.kind === "text" ? prepared.text : "";
    // Aucune balise Word résiduelle (c'était le cœur du bug).
    expect(text).not.toMatch(/<\/?w:/);
    expect(text).not.toMatch(/<[^>\n]{1,40}>/);
    // Aucun code de champ / propriété de tableau.
    expect(text).not.toMatch(/tblPr|tcBorders|w:val|w:pos/);
    // Le vrai contenu est bien là (y compris le tableau).
    expect(text).toContain("CelluleGauche");
    expect(text).toContain("CelluleDroite");
    // La tabulation sépare les mots (jamais « AvantAprès » collés).
    expect(text).not.toContain("AvantAprès");
    // Les caractères spéciaux sont décodés (pas « &amp; »).
    expect(text).toContain("Droits & responsabilités");
    expect(text).not.toContain("&amp;");
  });

  it("nettoyage universel : entités décodées, balises et caractères invisibles retirés", () => {
    // Décodage COMPLET des entités (numériques décimales/hex + nommées).
    expect(decodeXmlEntities("Il &#233;tait &#xE9;veill&eacute; &amp; caf&#233;")).toBe("Il était éveillé & café");
    expect(decodeXmlEntities("&laquo;&nbsp;Bonjour&nbsp;&raquo;")).toBe("« Bonjour »");
    // Normalisation : trait d'union conditionnel et espace de largeur nulle retirés,
    // espace insécable ramenée à une espace simple, espaces multiples compactées.
    expect(normalizeText("ex\u00ADem\u200Bple")).toBe("exemple");
    expect(normalizeText("mot\u00A0:\u00A0suite")).toBe("mot : suite");
    expect(normalizeText("trop    d'espaces")).toBe("trop d'espaces");
  });

  it("encodage défectueux / binaire : refusé proprement (jamais lu comme du texte)", async () => {
    const junk = Buffer.from([0x00, 0x1f, 0x8b, 0x08, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef]);
    const att = await extractUploadAttachment(junk, "application/octet-stream", "mystere.bin");
    expect(att.lu).toBe(false);
    expect(att.note && att.note.length).toBeGreaterThan(0);
  });
});
