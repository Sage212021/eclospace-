import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Stockage des fichiers de la GED (Ch. 21 §21.9) : les fichiers vivent hors
// base de données, seule leur référence (chemin/clé, hash) est en base.
//
// Deux modes, choisis automatiquement :
//  - PRODUCTION : stockage objet compatible S3 (Scaleway Object Storage, région
//    Paris), durable sur plusieurs années. Activé dès que les variables S3 sont
//    configurées.
//  - DÉVELOPPEMENT / TEST : disque local (aucune configuration requise).
//
// Les signatures storeFile/readStoredFile sont inchangées : les appelants
// (documents, BAT, comparateur…) n'ont pas à savoir où vivent les fichiers.
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), "uploads");

export interface StoredFile {
  filePath: string; // chemin absolu sur disque (dev) OU clé d'objet S3 (prod)
  sha256Hash: string;
  fileSize: number;
}

function s3Configured(): boolean {
  return Boolean(
    process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY &&
      (process.env.S3_ENDPOINT || process.env.S3_REGION),
  );
}

let cachedClient: S3Client | null = null;
function s3Client(): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: process.env.S3_REGION ?? "fr-par",
      endpoint: process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
      // Scaleway accepte l'URL « virtual-hosted » par défaut ; certains
      // fournisseurs exigent le style « path » — configurable au besoin.
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    });
  }
  return cachedClient;
}

// Une clé d'objet S3 ne commence jamais par « / » ; un chemin disque, si.
// Ce critère suffit à router readStoredFile vers le bon mode sans champ en base.
function isS3Key(filePath: string): boolean {
  return !filePath.startsWith("/");
}

export async function storeFile(buffer: Buffer, originalName: string): Promise<StoredFile> {
  const sha256Hash = createHash("sha256").update(buffer).digest("hex");
  const safeName = `${sha256Hash}-${originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  if (s3Configured()) {
    const key = `documents/${safeName}`;
    await s3Client().send(
      new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key, Body: buffer }),
    );
    return { filePath: key, sha256Hash, fileSize: buffer.byteLength };
  }

  const filePath = path.join(UPLOAD_DIR, safeName);
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(filePath, buffer);
  return { filePath, sha256Hash, fileSize: buffer.byteLength };
}

export async function readStoredFile(filePath: string): Promise<Buffer> {
  if (s3Configured() && isS3Key(filePath)) {
    const response = await s3Client().send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: filePath }),
    );
    const bytes = await response.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }
  return readFile(filePath);
}

// Lecture tolérante : renvoie null si le fichier/objet n'existe pas (au lieu de
// lever). Sert au cache des miniatures (voir imageOptimize.getOrCreateThumbnail).
export async function readStoredFileOrNull(filePath: string): Promise<Buffer | null> {
  try {
    return await readStoredFile(filePath);
  } catch {
    return null;
  }
}

// Écriture à une CLÉ/chemin EXACT (dérivé), sans le nommage par empreinte de
// storeFile — utilisé pour les fichiers dérivés comme les miniatures.
export async function writeStoredFileAt(filePath: string, buffer: Buffer): Promise<void> {
  if (s3Configured() && isS3Key(filePath)) {
    await s3Client().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: filePath, Body: buffer }));
    return;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
}
