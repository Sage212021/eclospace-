import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

// Chiffrement de la clé API Claude au repos (Lot IA-0). La clé n'est JAMAIS
// stockée en clair : on chiffre en AES-256-GCM avec une clé dérivée d'un secret
// serveur (AI_ENCRYPTION_KEY, à défaut SESSION_SECRET). Format renvoyé :
// base64(iv[12] | tag[16] | ciphertext).
function encryptionKey(): Buffer {
  const secret = process.env.AI_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("AI_ENCRYPTION_KEY ou SESSION_SECRET manquant pour chiffrer la clé IA.");
  }
  // Sel fixe : on veut une clé dérivée déterministe (même secret → même clé),
  // le secret serveur reste la vraie protection.
  return scryptSync(secret, "eclospace-ai-config", 32);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
