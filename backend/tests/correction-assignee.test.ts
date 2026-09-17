import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Attribution de la Correction éditoriale : on choisit le correcteur parmi les
// personnes du SERVICE Correction UNIQUEMENT. Un infographe ne peut jamais être
// affecté à la correction (cas « Bal des vampires » attribué par erreur à un
// infographe). Réassignation possible depuis l'étape courante.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("Attribution de la Correction éditoriale (service Correction uniquement)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let manuscriptId: string;
  let correcteurId: string;
  let relecteurId: string;
  let assistantId: string;
  let infographeId: string;
  const s = Math.random().toString(36).slice(2, 7);

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });

    correcteurId = (await createUserWithRole(`corr_${s}`, "CORRECTEUR", "Corr123!")).id;
    relecteurId = (await createUserWithRole(`relec_${s}`, "MEMBRE_COMITE_LECTURE", "Relec123!")).id;
    assistantId = (await createUserWithRole(`assist_${s}`, "ASSISTANT_EDITORIAL", "Assist123!")).id;
    infographeId = (await createUserWithRole(`info_${s}`, "RESP_INFOGRAPHIE", "Info123!")).id;

    // Manuscrit positionné à l'étape « Correction éditoriale ».
    const correction = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "CORRECTION" } });
    const m = await prisma.manuscript.create({
      data: {
        manuscriptNumber: `MS-BAL-${s}`, title: `Bal des vampires ${s}`, language: "fr",
        statusId: correction.id, ownerId: admin.id, receivedAt: new Date(),
        createdBy: admin.id, updatedBy: admin.id,
      },
    });
    manuscriptId = m.id;
  });

  afterAll(async () => {
    await prisma.manuscriptStep.deleteMany({ where: { manuscriptId } }).catch(() => {});
    await prisma.manuscript.deleteMany({ where: { id: manuscriptId } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("le sélecteur propose correcteurs, relecteurs, direction & assistant éditorial — jamais les infographes", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/current-step-assignees`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.step.code).toBe("CORRECTION");
    const ids = (body.assignees as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toContain(correcteurId);
    expect(ids).toContain(relecteurId);
    expect(ids).toContain(assistantId);
    expect(ids).not.toContain(infographeId);
  });

  it("attribue la correction à un relecteur (profil éditorial autorisé)", async () => {
    const res = await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${manuscriptId}/current-step/assignee`, headers: { cookie }, payload: { assignee_id: relecteurId } });
    expect(res.statusCode).toBe(200);
    const correction = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "CORRECTION" } });
    const step = await prisma.manuscriptStep.findUnique({ where: { manuscriptId_statusId: { manuscriptId, statusId: correction.id } } });
    expect(step?.responsibleId).toBe(relecteurId);
  });

  it("refuse d'attribuer la correction à un infographe (400)", async () => {
    const res = await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${manuscriptId}/current-step/assignee`, headers: { cookie }, payload: { assignee_id: infographeId } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("invalid_assignee");
  });
});
