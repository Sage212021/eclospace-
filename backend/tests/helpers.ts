import argon2 from "argon2";
import { prisma } from "../src/lib/prisma.js";

// Pas d'endpoint de création de compte au Lot 0 (RH complet = Lot 6) : les
// tests provisionnent directement via Prisma, comme le fait le seed.
export async function createUserWithRole(username: string, roleCode: string, password: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  const passwordHash = await argon2.hash(password);
  const user = await prisma.user.upsert({
    where: { username },
    update: { passwordHash, status: "active", mfaEnabled: false, mfaSecret: null },
    create: { username, email: `${username}@eclospace.local`, passwordHash, status: "active" },
  });
  const existing = await prisma.userRole.findFirst({ where: { userId: user.id, roleId: role.id, revokedAt: null } });
  if (!existing) {
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  return user;
}

export function extractSessionCookie(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  if (!raw) throw new Error("Aucun cookie de session reçu.");
  return raw.split(";")[0];
}

// Dépose un fichier source « Manuscrit (source) » pour un manuscrit, comme le
// fait POST /manuscripts/:id/source-file. Nécessaire dès qu'un test fait
// avancer un manuscrit au-delà de la vérification administrative : le passage
// au comité de lecture exige désormais que le fichier source soit déposé.
export async function seedManuscriptSourceFile(manuscriptId: string) {
  const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  const doc = await prisma.document.create({
    data: {
      entityType: "manuscript",
      entityId: manuscriptId,
      category: "manuscrit",
      title: "Manuscrit (source)",
      createdBy: admin.id,
      updatedBy: admin.id,
    },
  });
  await prisma.documentVersion.create({
    data: {
      documentId: doc.id,
      versionNumber: 1,
      filePath: `test/source-${manuscriptId}.txt`,
      fileSize: 12,
      mimeType: "text/plain",
      sha256Hash: "0".repeat(64),
      changeSummary: "Fichier source (seed de test)",
      uploadedBy: admin.id,
    },
  });
  return doc;
}

// Dépose les livrables OBLIGATOIRES du cycle de correction (rapport + version
// finale intégrée) pour permettre la validation de l'étape CORRECTION. Le nom
// des documents suit le préfixe stable « [correction:<clé>] » lu par le gate.
export async function seedCorrectionCycle(manuscriptId: string) {
  const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  for (const key of ["rapport_1", "integration_finale"]) {
    const doc = await prisma.document.create({
      data: {
        entityType: "manuscript",
        entityId: manuscriptId,
        category: "piece_etape",
        confidentiality: "interne",
        title: `[correction:${key}] seed-${key}.txt`,
        createdBy: admin.id,
        updatedBy: admin.id,
      },
    });
    await prisma.documentVersion.create({
      data: { documentId: doc.id, versionNumber: 1, filePath: `test/corr-${key}-${manuscriptId}.txt`, fileSize: 10, mimeType: "text/plain", sha256Hash: "0".repeat(64), changeSummary: "seed", uploadedBy: admin.id },
    });
  }
}

// Dépose le livrable de sortie d'une étape (verrou « pas d'avancement sans le
// fichier attendu »). Nécessaire pour valider les étapes soumises au verrou
// (Planification, Expertise, Réécriture, Mise en page, Infographie).
export async function seedStepDeliverable(manuscriptId: string, stepCode: string) {
  const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  const doc = await prisma.document.create({
    data: { entityType: "manuscript", entityId: manuscriptId, category: "piece_etape", confidentiality: "interne", title: `[livrable:${stepCode}] seed-${stepCode}.txt`, createdBy: admin.id, updatedBy: admin.id },
  });
  await prisma.documentVersion.create({
    data: { documentId: doc.id, versionNumber: 1, filePath: `test/livrable-${stepCode}-${manuscriptId}.txt`, fileSize: 10, mimeType: "text/plain", sha256Hash: "0".repeat(64), changeSummary: "seed", uploadedBy: admin.id },
  });
  return doc;
}

// isbn13 est unique en base : un préfixe de test statique collisionne dès la
// deuxième exécution de la suite sur une base non réinitialisée entre les runs.
export function uniqueIsbnPrefix(digitWidth: number): string {
  const length = 12 - digitWidth;
  let result = "";
  for (let i = 0; i < length; i++) result += Math.floor(Math.random() * 10).toString();
  return result;
}
