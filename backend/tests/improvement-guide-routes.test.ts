import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Guide d'amélioration (SAGE) — Phase 2 : suivi des observations EVAL-xxx et
// validation du comité « pour transmission à l'auteur ». On teste les routes
// sans appeler l'IA (on crée le guide + une observation directement en base).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("guide d'amélioration — suivi + validation (Phase 2)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let manuscriptId: string;
  let obsId: string;

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const genreId = (await prisma.genre.findFirstOrThrow({ where: { code: "ROMAN" } })).id;
    const created = await app.inject({ method: "POST", url: "/api/v1/manuscripts", headers: { cookie }, payload: { title: `Guide-${Math.random().toString(36).slice(2, 6)}`, genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "A", last_name: "B" } } });
    manuscriptId = created.json().id;
    // Guide (brouillon) + une observation, posés directement (pas d'appel IA).
    await prisma.document.create({
      data: {
        entityType: "manuscript", entityId: manuscriptId, category: "guide_amelioration", title: "GUIDE ÉDITORIAL D'AMÉLIORATION — test", createdBy: adminId,
        versions: { create: { versionNumber: 1, filePath: `test/guide-${manuscriptId}.docx`, fileSize: 10, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256Hash: `h${manuscriptId}`, status: "draft", uploadedBy: adminId } },
      },
    });
    const obs = await prisma.guideObservation.create({ data: { manuscriptId, number: 1, code: "EVAL-001", title: "Problématique à resserrer", priority: "majeure", recommendation: "Clarifier la question centrale dès l'introduction." } });
    obsId = obs.id;
  });

  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("liste le guide (brouillon) et ses observations", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/improvement-guide`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.guide?.validated).toBe(false);
    expect(body.observations).toHaveLength(1);
    expect(body.observations[0].code).toBe("EVAL-001");
    expect(body.observations[0].status).toBe("a_traiter");
  });

  it("met à jour l'état d'une observation", async () => {
    const res = await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${manuscriptId}/improvement-guide/observations/${obsId}`, headers: { cookie }, payload: { status: "en_cours" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("en_cours");
  });

  it("refuse un statut d'observation invalide", async () => {
    const res = await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${manuscriptId}/improvement-guide/observations/${obsId}`, headers: { cookie }, payload: { status: "n_importe_quoi" } });
    expect(res.statusCode).toBe(400);
  });

  it("valide le guide pour transmission", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/improvement-guide/validate`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/improvement-guide`, headers: { cookie } });
    expect(after.json().guide.validated).toBe(true);
  });
});
