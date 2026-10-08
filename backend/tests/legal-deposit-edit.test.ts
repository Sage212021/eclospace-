import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

// Correction d'une fiche de dépôt légal déjà enregistrée (pays / organisme /
// exemplaires / statut) en cas d'erreur de saisie.
describe("Dépôt légal — correction d'une fiche existante", () => {
  let app: FastifyInstance;
  let cookie: string;
  let manuscriptId: string;
  let depositId: string;
  const s = Math.random().toString(36).slice(2, 7);

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const st = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "ATTRIBUTION_REFERENCES" } });
    const m = await prisma.manuscript.create({ data: { manuscriptNumber: `MS-DL-${s}`, title: `Dépôt légal ${s}`, language: "fr", statusId: st.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } });
    manuscriptId = m.id;
    // Saisie initiale AVEC ERREUR (mauvais organisme et mauvais nombre).
    const dep = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/legal-deposits`, headers: { cookie }, payload: { country: "Frane", depository: "BNF-erreur", copies_required: 1 } });
    depositId = dep.json().id;
  });

  afterAll(async () => {
    await prisma.legalDeposit.deleteMany({ where: { manuscriptId } }).catch(() => {});
    await prisma.manuscript.deleteMany({ where: { id: manuscriptId } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("corrige pays / organisme / exemplaires et trace la modification", async () => {
    const r = await app.inject({
      method: "PATCH", url: `/api/v1/legal-deposits/${depositId}`, headers: { cookie },
      payload: { country: "France", depository: "BnF", copies_required: 2, status: "depose" },
    });
    expect(r.statusCode).toBe(200);
    const row = await prisma.legalDeposit.findUniqueOrThrow({ where: { id: depositId } });
    expect(row.country).toBe("France");
    expect(row.depository).toBe("BnF");
    expect(row.copiesRequired).toBe(2);
    expect(row.status).toBe("depose");
    const audit = await prisma.auditLog.count({ where: { entityType: "legal_deposit", entityId: depositId, action: "update" } });
    expect(audit).toBeGreaterThanOrEqual(1);
  });

  it("refuse une correction invalide (0 exemplaire)", async () => {
    const r = await app.inject({ method: "PATCH", url: `/api/v1/legal-deposits/${depositId}`, headers: { cookie }, payload: { copies_required: 0 } });
    expect(r.statusCode).toBe(400);
  });
});
