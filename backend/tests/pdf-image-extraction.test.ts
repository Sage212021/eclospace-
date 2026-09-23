import { describe, expect, it } from "vitest";
import { Jimp } from "jimp";
import { extractPdfImages } from "../src/lib/aiRunner.js";

// Faire LIRE par l'IA un PDF « image » LOURD : on extrait ses images et on les
// redimensionne (vision) au lieu de refuser. Ici on fabrique un PDF-image (une
// grande image intégrée) et on vérifie que l'extraction produit un JPEG léger et
// redimensionné — sans dépendance nouvelle (pdfjs-dist + jimp).

// Construit un PDF minimal valide contenant UNE image JPEG plein cadre (DCTDecode).
async function buildImagePdf(width: number, height: number): Promise<Buffer> {
  const src = new Jimp({ width, height, color: 0x3366ffff });
  const jpeg = Buffer.from(await src.getBuffer("image/jpeg"));
  const parts: Buffer[] = [];
  let pos = 0;
  const offs: Record<number, number> = {};
  const push = (s: string | Buffer) => { const b = Buffer.isBuffer(s) ? s : Buffer.from(s, "latin1"); parts.push(b); pos += b.length; };
  push("%PDF-1.4\n");
  offs[1] = pos; push("1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n");
  offs[2] = pos; push("2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n");
  offs[3] = pos; push(`3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${width} ${height}]/Resources<</XObject<</Im0 4 0 R>>>>/Contents 5 0 R>>endobj\n`);
  offs[4] = pos; push(`4 0 obj<</Type/XObject/Subtype/Image/Width ${width}/Height ${height}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${jpeg.length}>>stream\n`); push(jpeg); push("\nendstream endobj\n");
  const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
  offs[5] = pos; push(`5 0 obj<</Length ${content.length}>>stream\n${content}\nendstream endobj\n`);
  const xrefPos = pos;
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) xref += String(offs[i]).padStart(10, "0") + " 00000 n \n";
  push(xref);
  push(`trailer<</Size 6/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF`);
  return Buffer.concat(parts);
}

describe("Extraction d'images d'un PDF « image » (vision IA)", () => {
  it("extrait et REDIMENSIONNE l'image d'un PDF plein cadre (JPEG ≤ maxDim)", async () => {
    const pdf = await buildImagePdf(2400, 1600); // grande image (au-delà de 1600 px)
    const images = await extractPdfImages(pdf, { maxPages: 30, maxDim: 1600 });
    expect(images).not.toBeNull();
    expect(images!.length).toBe(1);
    expect(images![0].mediaType).toBe("image/jpeg");
    const jpg = Buffer.from(images![0].base64, "base64");
    // En-tête JPEG (SOI) : FF D8.
    expect(jpg[0]).toBe(0xff);
    expect(jpg[1]).toBe(0xd8);
    // Dimensions redimensionnées : le plus grand côté ≤ 1600.
    const decoded = await Jimp.read(jpg);
    expect(Math.max(decoded.bitmap.width, decoded.bitmap.height)).toBeLessThanOrEqual(1600);
  });

  it("renvoie null pour un fichier qui n'est pas un PDF exploitable", async () => {
    const images = await extractPdfImages(Buffer.from("pas un pdf"), { maxPages: 5 });
    expect(images).toBeNull();
  });
});
