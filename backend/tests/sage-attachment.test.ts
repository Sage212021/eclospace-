import { describe, expect, it } from "vitest";
import { Jimp } from "jimp";
import { extractUploadAttachment } from "../src/lib/aiAssistant.js";

// Pièce jointe dans la conversation avec SAGE : on doit pouvoir joindre « tout
// type de fichier ». Une IMAGE devient une pièce que SAGE « voit » (vision) ;
// un TEXTE reste du texte ; un binaire inconnu est marqué non lisible (note).
describe("pièce jointe SAGE (tout type de fichier)", () => {
  it("une image (mime faux) devient une pièce VISION normalisée en JPEG", async () => {
    const png = await new Jimp({ width: 48, height: 64, color: 0x3366ccff }).getBuffer("image/png");
    const att = await extractUploadAttachment(Buffer.from(png), "application/octet-stream", "couverture.bin");
    expect(att.lu).toBe(true);
    expect(att.images && att.images.length).toBe(1);
    expect(att.images![0].mediaType).toBe("image/jpeg");
    expect(att.text).toBe("");
  });

  it("un fichier texte reste du texte lisible", async () => {
    const att = await extractUploadAttachment(Buffer.from("Note de lecture : avis favorable.", "utf8"), "text/plain", "note.txt");
    expect(att.lu).toBe(true);
    expect(att.text).toContain("avis favorable");
    expect(att.images).toBeUndefined();
  });

  it("un binaire non reconnu est marqué non lisible avec une note", async () => {
    const junk = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00, 0xde, 0xad, 0xbe, 0xef]);
    const att = await extractUploadAttachment(junk, "application/x-unknown", "mystere.bin");
    expect(att.lu).toBe(false);
    expect(att.images).toBeUndefined();
    expect(att.note && att.note.length).toBeGreaterThan(0);
  });
});
