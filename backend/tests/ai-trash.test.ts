import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import { storeFile } from "../src/lib/storage.js";

// Corbeille du dossier éditorial : les productions IA (rapports, versions
// réécrites — catégorie « piece_etape ») peuvent être RETIRÉES du dossier actif
// (suppression logique) puis RESTAURÉES ; le manuscrit source original, lui, est
// protégé et ne peut jamais être mis à la corbeille.
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("Corbeille IA — retrait, liste, restauration, protection de l'original", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let manuscriptId: string;
  let aiDocId: string;
  let sourceDocId: string;
  const s = Math.random().toString(36).slice(2, 6);

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login("admin", ADMIN_PASSWORD);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const status = await prisma.workflowStatus.findFirstOrThrow();
    const ms = await prisma.manuscript.create({
      data: { manuscriptNumber: `TRASH-${s}`, title: `Ouvrage corbeille ${s}`, language: "fr", statusId: status.id, ownerId: adminId, receivedAt: new Date() },
    });
    manuscriptId = ms.id;

    // Le manuscrit SOURCE original (protégé) + une production IA (retirable).
    const src = await storeFile(Buffer.from("source", "utf8"), "src.txt");
    const source = await prisma.document.create({
      data: {
        entityType: "manuscript", entityId: ms.id, category: "manuscrit", title: "Manuscrit (source)", createdBy: adminId,
        versions: { create: { versionNumber: 1, filePath: src.filePath, fileSize: src.fileSize, mimeType: "text/plain", sha256Hash: src.sha256Hash, uploadedBy: adminId } },
      },
    });
    sourceDocId = source.id;
    const rew = await storeFile(Buffer.from("reecrit", "utf8"), "rew.docx");
    const ai = await prisma.document.create({
      data: {
        entityType: "manuscript", entityId: ms.id, category: "piece_etape", title: "Version réécrite (IA) — REECRITURE", createdBy: adminId,
        versions: { create: { versionNumber: 1, filePath: rew.filePath, fileSize: rew.fileSize, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256Hash: rew.sha256Hash, uploadedBy: adminId } },
      },
    });
    aiDocId = ai.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("met une production IA à la corbeille (avec motif), la liste, puis la restaure", async () => {
    // Mise à la corbeille avec un motif (résultat insatisfaisant).
    const del = await app.inject({
      method: "DELETE", url: `/api/v1/manuscripts/${manuscriptId}/step-documents/${aiDocId}`,
      headers: { cookie: adminCookie }, payload: { reason: "Résultat insatisfaisant", comment: "à régénérer" },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().removed).toBe(true);

    // La corbeille contient la production IA retirée, PAS le manuscrit source.
    const trash = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/trash`, headers: { cookie: adminCookie } });
    expect(trash.statusCode).toBe(200);
    const rows = trash.json() as Array<{ id: string; can_restore: boolean }>;
    expect(rows.some((r) => r.id === aiDocId)).toBe(true);
    expect(rows.some((r) => r.id === sourceDocId)).toBe(false);
    expect(rows.find((r) => r.id === aiDocId)!.can_restore).toBe(true);

    // Le motif est tracé dans le journal d'audit (append-only).
    const audit = await prisma.auditLog.findFirst({ where: { entityId: aiDocId, action: "update" }, orderBy: { occurredAt: "desc" } });
    expect(JSON.stringify(audit?.newValues ?? {})).toContain("Résultat insatisfaisant");

    // Restauration : la pièce revient dans le dossier actif.
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/step-documents/${aiDocId}/restore`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().restored).toBe(true);
    const active = await prisma.document.findUniqueOrThrow({ where: { id: aiDocId } });
    expect(active.deletedAt).toBeNull();
    const trash2 = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/trash`, headers: { cookie: adminCookie } });
    expect((trash2.json() as Array<{ id: string }>).some((r) => r.id === aiDocId)).toBe(false);
  });

  it("refuse de mettre le manuscrit source original à la corbeille (protégé)", async () => {
    const del = await app.inject({ method: "DELETE", url: `/api/v1/manuscripts/${manuscriptId}/step-documents/${sourceDocId}`, headers: { cookie: adminCookie } });
    expect(del.statusCode).toBe(404);
    const stillThere = await prisma.document.findUniqueOrThrow({ where: { id: sourceDocId } });
    expect(stillThere.deletedAt).toBeNull();
  });
});
