import { describe, expect, it } from "vitest";
import { Jimp } from "jimp";
import { looksTextual, prepareVisualOrText } from "../src/lib/aiRunner.js";

// Lecture ROBUSTE des fichiers de couverture / manuscrit (demande opérateur :
// « les relecteurs doivent pouvoir lire tout type de fichier, convertir, etc. »).
// On vérifie que les images sont NORMALISÉES en JPEG pour la vision de l'IA, que
// le texte reste du texte, et qu'un binaire illisible est refusé proprement
// (message clair) plutôt que transmis en charabia.
describe("lecture robuste des fichiers (couverture)", () => {
  it("distingue le texte du binaire", () => {
    expect(looksTextual(Buffer.from("Bonjour, ceci est une couverture : titre + auteur.", "utf8"))).toBe(true);
    expect(looksTextual(Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0x00]))).toBe(false);
  });

  it("normalise une image PNG en JPEG pour la vision (quel que soit le mime déposé)", async () => {
    const img = new Jimp({ width: 40, height: 60, color: 0xffcc00ff });
    const png = await img.getBuffer("image/png");
    // mime déposé volontairement FAUX (octet-stream) : la détection par octets corrige.
    const prepared = await prepareVisualOrText("application/octet-stream", Buffer.from(png));
    expect(prepared.kind).toBe("images");
    if (prepared.kind === "images") {
      expect(prepared.images).toHaveLength(1);
      expect(prepared.images[0].mediaType).toBe("image/jpeg");
      expect(prepared.images[0].base64.length).toBeGreaterThan(0);
    }
  });

  it("normalise aussi une image TIFF (format impression courant)", async () => {
    const img = new Jimp({ width: 32, height: 32, color: 0x112233ff });
    const tiff = await img.getBuffer("image/tiff");
    const prepared = await prepareVisualOrText("image/tiff", Buffer.from(tiff));
    expect(prepared.kind).toBe("images");
    if (prepared.kind === "images") expect(prepared.images[0].mediaType).toBe("image/jpeg");
  });

  it("garde le texte lisible comme texte", async () => {
    const prepared = await prepareVisualOrText("text/plain", Buffer.from("Texte de 4e de couverture.", "utf8"));
    expect(prepared.kind).toBe("text");
    if (prepared.kind === "text") expect(prepared.text).toContain("4e de couverture");
  });

  it("refuse proprement un binaire non reconnu (message clair, pas de charabia)", async () => {
    const junk = Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44, 0x00, 0x99, 0xab, 0xcd]);
    await expect(prepareVisualOrText("application/x-unknown", junk)).rejects.toThrow(/n'a pas pu lire/i);
  });
});
