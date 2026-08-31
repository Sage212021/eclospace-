import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Cohérence des dossiers : un ouvrage à sa position officielle (Décision
// éditoriale) mais avec une étape « active » plus avancée (Correction) est
// « à plusieurs étapes à la fois » → détecté, réalignable, et sa tâche de
// correction ne pollue plus « Mes corrections ».

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("Cohérence des dossiers (maintenance workflow)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let manuscriptId: string;
  let stepId: string;
  const s = Math.random().toString(36).slice(2, 6);

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const decision = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "DECISION_EDITORIALE" } });
    const correction = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "CORRECTION" } });

    // Ouvrage à sa position officielle « Décision éditoriale ».
    const ms = await prisma.manuscript.create({
      data: { manuscriptNumber: `CONS-${s}`, title: `Ouvrage incohérent ${s}`, language: "fr", statusId: decision.id, ownerId: adminId, receivedAt: new Date() },
    });
    manuscriptId = ms.id;
    // Étape-fantôme « Correction » restée active (responsable assigné, non validée).
    const step = await prisma.manuscriptStep.create({ data: { manuscriptId: ms.id, statusId: correction.id, responsibleId: adminId } });
    stepId = step.id;
    // Tâche de correction rattachée à cette étape.
    await prisma.task.create({ data: { manuscriptId: ms.id, stepId: step.id, title: "Correction éditoriale", type: "correction", assigneeId: adminId, createdBy: adminId, updatedBy: adminId } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("le diagnostic détecte l'ouvrage à plusieurs étapes à la fois", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/maintenance/step-consistency", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const found = (res.json().manuscripts as { id: string; stray_steps: { code: string }[] }[]).find((m) => m.id === manuscriptId);
    expect(found).toBeTruthy();
    expect(found!.stray_steps.some((x) => x.code === "CORRECTION")).toBe(true);
  });

  it("« Mes corrections » n'affiche PAS la tâche-fantôme (ouvrage pas à l'étape Correction)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/my-corrections", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const list = res.json() as { manuscript: { id: string } }[];
    expect(list.some((t) => t.manuscript.id === manuscriptId)).toBe(false);
  });

  it("le réalignement réinitialise l'étape-fantôme et annule sa tâche", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/maintenance/step-consistency/realign", headers: { cookie }, payload: { manuscript_ids: [manuscriptId] } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.realigned).toBe(1);
    expect(body.steps_reset).toBe(1);
    expect(body.tasks_cancelled).toBe(1);

    const step = await prisma.manuscriptStep.findUniqueOrThrow({ where: { id: stepId } });
    expect(step.responsibleId).toBeNull();
    const task = await prisma.task.findFirst({ where: { stepId } });
    expect(task?.deletedAt).not.toBeNull();

    // Plus aucun dossier incohérent pour cet ouvrage.
    const after = await app.inject({ method: "GET", url: "/api/v1/maintenance/step-consistency", headers: { cookie } });
    expect((after.json().manuscripts as { id: string }[]).some((m) => m.id === manuscriptId)).toBe(false);
  });
});
