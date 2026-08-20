import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";

// Liste officielle « Livres & ISBN » (docx opérateur) appliquée par le seed :
// ISBN définitifs + prix publics. On vérifie quelques entrées représentatives
// (une correction d'ISBN provisoire, un nouvel ouvrage, un prix renseigné).

describe("catalogue officiel (liste livres & ISBN)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function byNum(num: string) {
    return prisma.manuscript.findUnique({ where: { manuscriptNumber: num }, include: { workMetadata: true, isbns: true } });
  }

  it("corrige l'ISBN provisoire et renseigne le prix (Réalités épineuses)", async () => {
    const m = await byNum("LG-CAT-0094");
    expect(m).toBeTruthy();
    expect(m!.isbns.some((i) => i.isbn13 === "9789956378155")).toBe(true);
    expect(m!.isbns.some((i) => i.isbn13.startsWith("978200190"))).toBe(false); // plus d'ISBN provisoire
    expect(Number(m!.workMetadata?.pricePublic)).toBe(5000);
  });

  it("ajoute un ouvrage absent du catalogue (Afrique première puissance)", async () => {
    const m = await byNum("LG-CAT-0101");
    expect(m).toBeTruthy();
    expect(m!.title).toBe("Afrique première puissance");
    expect(m!.isbns.some((i) => i.isbn13 === "9789956078332")).toBe(true);
    expect(Number(m!.workMetadata?.pricePublic)).toBe(10000);
  });

  it("renseigne le prix public d'un ouvrage existant (Le Roi Mbella)", async () => {
    const m = await byNum("LG-CAT-0080");
    expect(Number(m!.workMetadata?.pricePublic)).toBe(5000);
  });
});
