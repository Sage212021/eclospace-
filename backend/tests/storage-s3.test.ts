import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import S3rver from "s3rver";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import { storeFile, readStoredFile } from "../src/lib/storage.js";

// Vérifie le chemin de stockage objet (S3) sans dépendre d'un fournisseur réel :
// un serveur S3 compatible en mémoire (s3rver, même protocole que Scaleway) est
// démarré le temps du test. En production, les mêmes appels visent Scaleway
// Object Storage. En dev/test habituel (variables S3 absentes), storage.ts
// retombe sur le disque local — couvert par les autres tests (documents, BAT…).
describe("stockage objet (S3)", () => {
  let server: S3rver;
  const dataDir = mkdtempSync(path.join(tmpdir(), "s3rver-"));

  beforeAll(async () => {
    server = new S3rver({ port: 9192, address: "127.0.0.1", silent: true, directory: dataDir });
    await new Promise<void>((resolve) => server.run(() => resolve()));

    process.env.S3_ENDPOINT = "http://127.0.0.1:9192";
    process.env.S3_REGION = "us-east-1";
    process.env.S3_BUCKET = "eclospace-docs-test";
    process.env.S3_ACCESS_KEY_ID = "S3RVER";
    process.env.S3_SECRET_ACCESS_KEY = "S3RVER";
    process.env.S3_FORCE_PATH_STYLE = "true";

    const admin = new S3Client({
      region: "us-east-1",
      endpoint: "http://127.0.0.1:9192",
      credentials: { accessKeyId: "S3RVER", secretAccessKey: "S3RVER" },
      forcePathStyle: true,
    });
    await admin.send(new CreateBucketCommand({ Bucket: "eclospace-docs-test" }));
  });

  afterAll(async () => {
    // Ne pas laisser la config S3 fuiter vers d'autres fichiers de test.
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_REGION;
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.S3_FORCE_PATH_STYLE;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("dépose un fichier sur S3 (clé d'objet) et le relit à l'identique", async () => {
    const original = Buffer.from("Contrat d'auteur signé — page 1\n" + "x".repeat(4096), "utf8");
    const stored = await storeFile(original, "contrat auteur.pdf");

    // En mode S3, la référence est une clé d'objet (jamais un chemin disque).
    expect(stored.filePath.startsWith("/")).toBe(false);
    expect(stored.filePath).toContain("documents/");
    expect(stored.fileSize).toBe(original.byteLength);

    const readBack = await readStoredFile(stored.filePath);
    expect(Buffer.compare(original, readBack)).toBe(0);
  });
});
