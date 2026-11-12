import { describe, expect, it } from "vitest";
import { prepareVisualOrText } from "../src/lib/aiRunner.js";

// Le relecteur IA (rapports d'évaluation, corrections BAT1/BAT2) doit pouvoir
// lire TOUT type de fichier, pas seulement .docx (demande opérateur). On vérifie
// RTF, OpenDocument (.odt), le repli « au mieux » sur un binaire contenant du
// texte, et le rejet propre d'un binaire sans aucun texte.

// Construit une entrée ZIP STORE (non compressée) : en-tête local + nom + données.
function storeEntry(name: string, content: string): Buffer {
  const nameBuf = Buffer.from(name, "utf8");
  const data = Buffer.from(content, "utf8");
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); // signature d'en-tête local
  h.writeUInt16LE(20, 4); // version
  h.writeUInt16LE(0, 6); // flags
  h.writeUInt16LE(0, 8); // méthode 0 = STORE (pas de compression)
  h.writeUInt16LE(0, 10); // heure
  h.writeUInt16LE(0, 12); // date
  h.writeUInt32LE(0, 14); // crc32 (non vérifié par notre lecteur)
  h.writeUInt32LE(data.length, 18); // taille compressée
  h.writeUInt32LE(data.length, 22); // taille décompressée
  h.writeUInt16LE(nameBuf.length, 26);
  h.writeUInt16LE(0, 28); // extra
  return Buffer.concat([h, nameBuf, data]);
}
function storeZip(entries: { name: string; content: string }[]): Buffer {
  return Buffer.concat(entries.map((e) => storeEntry(e.name, e.content)));
}

const textOf = (r: Awaited<ReturnType<typeof prepareVisualOrText>>) => (r as { kind: "text"; text: string }).text;

describe("relecteur IA — lecture de tout type de fichier", () => {
  it("lit un RTF (texte extrait, balisage retiré)", async () => {
    const rtf = Buffer.from("{\\rtf1\\ansi\\deff0 Bonjour \\b RTF\\b0  : ceci est lisible.\\par Deuxi\\'e8me ligne.}", "latin1");
    const r = await prepareVisualOrText("application/rtf", rtf);
    expect(r.kind).toBe("text");
    expect(textOf(r)).toContain("Bonjour");
    expect(textOf(r)).toContain("RTF");
    expect(textOf(r)).toContain("Deuxième ligne");
  });

  it("lit un OpenDocument (.odt)", async () => {
    const buf = storeZip([
      { name: "mimetype", content: "application/vnd.oasis.opendocument.text" },
      { name: "content.xml", content: "<office:document-content><office:body><office:text><text:p>Texte ODT de test, lisible et suffisamment long.</text:p><text:p>Deuxième paragraphe du document ODT.</text:p></office:text></office:body></office:document-content>" },
    ]);
    const r = await prepareVisualOrText("application/octet-stream", buf);
    expect(r.kind).toBe("text");
    expect(textOf(r)).toContain("Texte ODT de test");
    expect(textOf(r)).toContain("Deuxième paragraphe du document ODT");
  });

  it("extrait au mieux le texte d'un binaire de format inconnu (jamais de rejet si lisible)", async () => {
    const marker = "Contenu lisible du manuscrit malgré un format binaire inconnu, assez long pour dépasser le seuil.";
    const buf = Buffer.concat([Buffer.from([0, 1, 2, 3, 0, 0, 7, 8]), Buffer.from(marker, "latin1"), Buffer.from([0, 0, 0])]);
    const r = await prepareVisualOrText("application/octet-stream", buf);
    expect(r.kind).toBe("text");
    expect(textOf(r)).toContain("Contenu lisible du manuscrit");
  });

  it("rejette proprement un binaire SANS aucun texte exploitable", async () => {
    const buf = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    await expect(prepareVisualOrText("application/octet-stream", buf)).rejects.toBeTruthy();
  });
});
