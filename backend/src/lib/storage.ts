import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Stockage local pour le développement. En production cloud, ce module sera
// remplacé par un client compatible S3 sans changer les appelants
// (voir docs/JOURNAL_TECHNIQUE.md) — les fichiers vivent hors base de données,
// seule leur référence (chemin, hash) est en base (Ch. 21 §21.9).
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), "uploads");

export interface StoredFile {
  filePath: string;
  sha256Hash: string;
  fileSize: number;
}

export async function storeFile(buffer: Buffer, originalName: string): Promise<StoredFile> {
  const sha256Hash = createHash("sha256").update(buffer).digest("hex");
  const safeName = `${sha256Hash}-${originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const filePath = path.join(UPLOAD_DIR, safeName);

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(filePath, buffer);

  return { filePath, sha256Hash, fileSize: buffer.byteLength };
}

export async function readStoredFile(filePath: string): Promise<Buffer> {
  return readFile(filePath);
}
