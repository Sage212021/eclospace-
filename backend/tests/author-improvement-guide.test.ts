import { afterAll, beforeAll, describe, expect, it } from "vitest";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Accompagnement de l'auteur (Phase 3) : l'auteur ne voit le guide d'amélioration
// QUE lorsque le comité l'a validé (transmis), et il suit sa propre progression.

const PWD = "AuthorGuide123!";

describe("guide d'amélioration — côté auteur (Phase 3)", () => {
  let app: FastifyInstance;
  let cookieOwner = "";
  let cookieOther = "";
  let manuscriptId = "";
  let versionId = "";
  let obsId = "";

  const login = async (u: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    const rnd = () => Math.random().toString(36).slice(2, 7);
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "COMITE_LECTURE" } });

    const tag = rnd();
    const partner = await prisma.partner.create({ data: { category: "auteur", firstName: tag, lastName: "Test", email: `${tag}@ex.test` } });
    const owner = await prisma.user.create({ data: { username: `auth_${tag}`, email: `${tag}@ex.test`, passwordHash: await argon2.hash(PWD), status: "active", accountType: "external", partnerId: partner.id } });
    const ms = await prisma.manuscript.create({ data: { manuscriptNumber: `MS-T-${tag}`, title: `Guide auteur ${tag}`, language: "fr", origin: "soumission", statusId: status.id, ownerId: adminId, receivedAt: new Date("2026-05-01") } });
    manuscriptId = ms.id;
    await prisma.workContributor.create({ data: { manuscriptId: ms.id, partnerId: partner.id, role: "author" } });

    const guide = await prisma.document.create({
      data: {
        entityType: "manuscript", entityId: ms.id, category: "guide_amelioration", title: "GUIDE — test", createdBy: adminId,
        versions: { create: { versionNumber: 1, filePath: `t/g-${ms.id}.docx`, fileSize: 10, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256Hash: `h${ms.id}`, status: "draft", uploadedBy: adminId } },
      },
      include: { versions: true },
    });
    versionId = guide.versions[0].id;
    obsId = (await prisma.guideObservation.create({ data: { manuscriptId: ms.id, number: 1, code: "EVAL-001", title: "Resserrer la problématique", priority: "majeure", recommendation: "Clarifier la question centrale." } })).id;

    // Deuxième auteur sans lien avec l'ouvrage.
    const tag2 = rnd();
    const p2 = await prisma.partner.create({ data: { category: "auteur", firstName: tag2, lastName: "Autre", email: `${tag2}@ex.test` } });
    await prisma.user.create({ data: { username: `auth_${tag2}`, email: `${tag2}@ex.test`, passwordHash: await argon2.hash(PWD), status: "active", accountType: "external", partnerId: p2.id } });

    cookieOwner = await login(`auth_${tag}`);
    cookieOther = await login(`auth_${tag2}`);
  });

  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("brouillon : rien n'est transmis à l'auteur", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/author/works/${manuscriptId}/improvement-guide`, headers: { cookie: cookieOwner } });
    expect(res.statusCode).toBe(200);
    expect(res.json().available).toBe(false);
  });

  it("un autre auteur n'accède pas à l'ouvrage (404)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/author/works/${manuscriptId}/improvement-guide`, headers: { cookie: cookieOther } });
    expect(res.statusCode).toBe(404);
  });

  it("une fois validé, l'auteur voit ses recommandations et suit sa progression", async () => {
    await prisma.documentVersion.update({ where: { id: versionId }, data: { status: "validated" } });
    const res = await app.inject({ method: "GET", url: `/api/v1/author/works/${manuscriptId}/improvement-guide`, headers: { cookie: cookieOwner } });
    expect(res.json().available).toBe(true);
    expect(res.json().observations[0].code).toBe("EVAL-001");

    const patch = await app.inject({ method: "PATCH", url: `/api/v1/author/works/${manuscriptId}/improvement-guide/observations/${obsId}`, headers: { cookie: cookieOwner }, payload: { status: "en_cours" } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().status).toBe("en_cours");
  });

  it("l'auteur ne peut pas poser un statut réservé au comité (400)", async () => {
    const res = await app.inject({ method: "PATCH", url: `/api/v1/author/works/${manuscriptId}/improvement-guide/observations/${obsId}`, headers: { cookie: cookieOwner }, payload: { status: "ecarte" } });
    expect(res.statusCode).toBe(400);
  });
});
