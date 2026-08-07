import { describe, it, expect } from "vitest";
import { Jimp } from "jimp";
import { storeFile, readStoredFileOrNull } from "../src/lib/storage.js";
import { getOrCreateThumbnail } from "../src/lib/imageOptimize.js";

// Miniatures d'images : à partir d'une image stockée (couverture, affiche…), on
// produit une petite version légère (JPEG, ≤ 360 px) mise en cache, pour les
// aperçus et les listes — sans transférer l'image pleine taille.

describe("miniatures d'images (aperçus légers)", () => {
  it("génère une miniature ≤ 360 px en JPEG, plus légère que l'original, et la met en cache", async () => {
    // Image source volumineuse (1200 × 900). Le stockage est adressé par contenu
    // (hash SHA-256) : on rend l'image unique à chaque exécution (couleur
    // aléatoire) pour que le chemin — et donc le cache de miniature — soit neuf,
    // sinon un .thumb.jpg laissé par une exécution précédente ferait échouer
    // l'assertion « aucune miniature au départ ».
    const color = ((Math.floor(Math.random() * 0xffffff) << 8) | 0xff) >>> 0;
    const src = new Jimp({ width: 1200, height: 900, color });
    const buf = await src.getBuffer("image/png");
    const stored = await storeFile(buf, `test-thumb-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);

    // Aucune miniature en cache au départ.
    expect(await readStoredFileOrNull(stored.filePath + ".thumb.jpg")).toBeNull();

    const thumb = await getOrCreateThumbnail(stored.filePath);
    expect(thumb.mime).toBe("image/jpeg");

    const timg = await Jimp.read(thumb.buffer);
    expect(Math.max(timg.width, timg.height)).toBeLessThanOrEqual(360);
    expect(thumb.buffer.byteLength).toBeLessThan(buf.byteLength);

    // La miniature est désormais en cache (2e accès servi sans régénération).
    expect(await readStoredFileOrNull(stored.filePath + ".thumb.jpg")).not.toBeNull();
    const again = await getOrCreateThumbnail(stored.filePath);
    expect(again.buffer.byteLength).toBe(thumb.buffer.byteLength);
  });
});
