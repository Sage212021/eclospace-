import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Clôture « perso » d'une intégration par l'intégrateur (rangement dans
// l'accordéon Historique) : autorisée seulement une fois le fichier final déposé,
// réservée à l'intégrateur désigné (ou la direction), réversible.

const rnd = () => Math.random().toString(36).slice(2, 7);

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

// Dépose un RAPPORT de correction texte (1re correction) — c'est ce qui rend
// l'ouvrage visible pour l'intégrateur (le correcteur a transmis quelque chose).
async function seedReportText(manuscriptId: string, uploaderId: string) {
  const doc = await prisma.document.create({
    data: { entityType: "manuscript", entityId: manuscriptId, category: "piece_etape", confidentiality: "interne", title: `[correction:rapport_1] rapport-${rnd()}.txt`, createdBy: uploaderId, updatedBy: uploaderId },
  });
  await prisma.documentVersion.create({
    data: { documentId: doc.id, versionNumber: 1, filePath: `test/rap-${manuscriptId}.txt`, fileSize: 10, mimeType: "text/plain", sha256Hash: "0".repeat(64), changeSummary: "seed", uploadedBy: uploaderId },
  });
}

// Dépose la version corrigée finale (fichier final texte) directement en base.
async function seedFinalText(manuscriptId: string, uploaderId: string) {
  const doc = await prisma.document.create({
    data: { entityType: "manuscript", entityId: manuscriptId, category: "piece_etape", confidentiality: "interne", title: `[correction:integration_finale] vcf-${rnd()}.txt`, createdBy: uploaderId, updatedBy: uploaderId },
  });
  await prisma.documentVersion.create({
    data: { documentId: doc.id, versionNumber: 1, filePath: `test/vcf-${manuscriptId}.txt`, fileSize: 10, mimeType: "text/plain", sha256Hash: "0".repeat(64), changeSummary: "seed", uploadedBy: uploaderId },
  });
}

describe("Clôture de l'intégration (Historique)", () => {
  let app: FastifyInstance;
  let integCookie: string;
  let integId: string;
  let otherId: string;
  let otherCookie: string;
  let adminId: string;
  let manuscriptId: string;
  const s = rnd();

  beforeAll(async () => {
    app = await buildApp();
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const integ = await createUserWithRole(`integclo_${s}`, "ASSISTANT_EDITORIAL", "Integ1!pass");
    integId = integ.id;
    const other = await createUserWithRole(`integclo2_${s}`, "ASSISTANT_EDITORIAL", "Integ1!pass");
    otherId = other.id;
    const st = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "CORRECTION" } });
    const m = await prisma.manuscript.create({ data: { manuscriptNumber: `MS-CLO-${s}`, title: `Clôture ${s}`, language: "fr", statusId: st.id, ownerId: adminId, correctionIntegratorId: integId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } });
    manuscriptId = m.id;
    // Le correcteur a transmis un rapport → l'ouvrage apparaît à l'intégrateur.
    await seedReportText(manuscriptId, adminId);
    integCookie = await loginCookie(app, `integclo_${s}`, "Integ1!pass");
    otherCookie = await loginCookie(app, `integclo2_${s}`, "Integ1!pass");
  });

  afterAll(async () => {
    await prisma.documentVersion.deleteMany({ where: { document: { entityId: manuscriptId } } }).catch(() => {});
    await prisma.document.deleteMany({ where: { entityType: "manuscript", entityId: manuscriptId } }).catch(() => {});
    await prisma.manuscript.deleteMany({ where: { id: manuscriptId } }).catch(() => {});
    await prisma.userRole.deleteMany({ where: { userId: { in: [integId, otherId] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [integId, otherId] } } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  const myItem = async (cookie: string) => {
    const r = await app.inject({ method: "GET", url: "/api/v1/my-correction-integrations", headers: { cookie } });
    const body = r.json() as { manuscripts: Array<{ id: string; branch: string; closed_at: string | null; can_close: boolean }> };
    return body.manuscripts.find((x) => x.id === manuscriptId && x.branch === "texte") ?? null;
  };

  it("sans fichier final : l'ouvrage est actif, can_close=false, et clore renvoie 409", async () => {
    const before = await myItem(integCookie);
    expect(before?.closed_at).toBeNull();
    expect(before?.can_close).toBe(false);

    const close = await app.inject({ method: "PUT", url: `/api/v1/manuscripts/${manuscriptId}/integration-closure`, headers: { cookie: integCookie }, payload: { branch: "texte", closed: true } });
    expect(close.statusCode).toBe(409);
    expect(close.json().code).toBe("final_missing");
  });

  it("une fois le fichier final déposé : can_close=true, la clôture réussit et range l'ouvrage", async () => {
    await seedFinalText(manuscriptId, integId);
    const ready = await myItem(integCookie);
    expect(ready?.can_close).toBe(true);

    const close = await app.inject({ method: "PUT", url: `/api/v1/manuscripts/${manuscriptId}/integration-closure`, headers: { cookie: integCookie }, payload: { branch: "texte", closed: true } });
    expect(close.statusCode).toBe(200);

    const after = await myItem(integCookie);
    expect(after?.closed_at).toBeTruthy();
  });

  it("rouvrir remet l'ouvrage en actif (closed_at nul)", async () => {
    const reopen = await app.inject({ method: "PUT", url: `/api/v1/manuscripts/${manuscriptId}/integration-closure`, headers: { cookie: integCookie }, payload: { branch: "texte", closed: false } });
    expect(reopen.statusCode).toBe(200);
    const after = await myItem(integCookie);
    expect(after?.closed_at).toBeNull();
  });

  it("un utilisateur qui n'est pas l'intégrateur désigné ne peut pas clore (403)", async () => {
    const close = await app.inject({ method: "PUT", url: `/api/v1/manuscripts/${manuscriptId}/integration-closure`, headers: { cookie: otherCookie }, payload: { branch: "texte", closed: true } });
    expect(close.statusCode).toBe(403);
    expect(close.json().code).toBe("forbidden");
  });
});
