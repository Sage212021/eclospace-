import { afterAll, describe, expect, it } from "vitest";

const { prisma } = await import("../src/lib/prisma.js");
const { domainesCollectionsText } = await import("../src/lib/aiRunner.js");

// Ligne éditoriale recalibrée (06/09/2026) : Spiritualité retirée comme domaine,
// orphelins rattachés, chartes par collection + règle transversale thème/doctrine.
describe("Ligne éditoriale — chartes, Spiritualité retirée, aucun orphelin", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("Spiritualité n'est plus un domaine actif", async () => {
    const active = await prisma.genre.findMany({ where: { deletedAt: null }, select: { label: true } });
    expect(active.some((g) => /spiritualit/i.test(g.label))).toBe(false);
  });

  it("aucun domaine officiel n'est « orphelin » (tous rattachés à une collection)", async () => {
    // On cible les domaines OFFICIELS du référentiel (les autres tests créent
    // leurs propres genres jetables, hors périmètre de la ligne éditoriale).
    const officialCodes = ["ROMAN", "ESSAI", "POESIE", "MANUEL", "JEUNESSE", "CONTE", "DOCUMENT", "TEMOIGNAGE", "DEV_PERSO", "SCIENCES_HUMAINES", "THEATRE"];
    const orphans = await prisma.genre.findMany({
      where: { deletedAt: null, collectionId: null, code: { in: officialCodes } },
      select: { label: true },
    });
    expect(orphans.map((g) => g.label)).toEqual([]);
  });

  it("les orphelins sont rattachés comme convenu (Conte→Héritier, Manuel/Document/Témoignage→Sources)", async () => {
    const rows = await prisma.genre.findMany({
      where: { deletedAt: null, code: { in: ["CONTE", "MANUEL", "DOCUMENT", "TEMOIGNAGE"] } },
      select: { code: true, collection: { select: { code: true } } },
    });
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r.collection?.code]));
    expect(byCode.CONTE).toBe("HERITIER");
    expect(byCode.MANUEL).toBe("SOURCES");
    expect(byCode.DOCUMENT).toBe("SOURCES");
    expect(byCode.TEMOIGNAGE).toBe("SOURCES");
  });

  it("le texte transmis à l'IA porte les 3 chartes + la règle thème/doctrine, sans fourre-tout ni Spiritualité", async () => {
    const t = await domainesCollectionsText();
    // Les 3 collections et leurs chartes.
    expect(t).toContain("Collection Canarie — Création littéraire");
    expect(t).toContain("Collection Héritier — Jeunesse & patrimoine");
    expect(t).toContain("Collection Sources — Savoir, réflexion & pratique");
    // La règle transversale thème (toléré) / doctrine (proscrite).
    expect(t).toContain("Règle transversale");
    expect(t).toContain("LÉGITIME et n'abaisse EN RIEN l'adéquation");
    expect(t).toContain("endoctrinement");
    // Plus de bloc fourre-tout « autres domaines », ni Spiritualité listée.
    expect(t).not.toContain("Autres domaines");
    expect(t).not.toContain("Spiritualité");
  });
});
