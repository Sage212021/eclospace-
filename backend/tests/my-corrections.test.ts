import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Entrée/sortie du correcteur : « Mes corrections » liste ses tâches ; il
// télécharge le manuscrit à corriger (entrée) et dépose la version corrigée
// (sortie), DEPUIS sa tâche, sans le droit large « documents ». Contrôle
// d'accès : seul le correcteur affecté.

const PWD = "Corr123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

describe("Mes corrections — entrée/sortie du correcteur", () => {
  let app: FastifyInstance;
  let corrCookie: string;
  let otherCookie: string;
  let taskId: string;

  beforeAll(async () => {
    app = await buildApp();
    const corr = `corr_${rnd()}`;
    const corrUser = await createUserWithRole(corr, "CORRECTEUR", PWD);
    corrCookie = await login(app, corr);
    const other = `corr2_${rnd()}`;
    await createUserWithRole(other, "CORRECTEUR", PWD);
    otherCookie = await login(app, other);

    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "CORRECTION" } });
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const m = await prisma.manuscript.create({
      data: {
        manuscriptNumber: `MS-CORR-${rnd()}`,
        title: `Manuscrit à corriger ${rnd()}`,
        statusId: status.id,
        ownerId: admin.id,
        origin: "soumission",
        language: "fr",
        receivedAt: new Date(),
      },
    });
    const task = await prisma.task.create({
      data: { manuscriptId: m.id, title: "Correction orthographique", type: "correction_ortho", assigneeId: corrUser.id },
    });
    taskId = task.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("liste les corrections du correcteur avec les drapeaux de fichiers", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/my-corrections", headers: { cookie: corrCookie } });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(Array.isArray(list)).toBe(true);
    const mine = list.find((t: { id: string }) => t.id === taskId);
    expect(mine).toBeTruthy();
    expect(mine.manuscriptHasFile).toBe(false);
    expect(mine.correctedHasFile).toBe(false);
  });

  it("404 explicite tant qu'aucun fichier manuscrit n'est déposé (correcteur affecté)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/tasks/${taskId}/manuscript-file`, headers: { cookie: corrCookie } });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("no_manuscript_file");
  });

  it("refuse le téléchargement à un autre correcteur (403)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/tasks/${taskId}/manuscript-file`, headers: { cookie: otherCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("refuse le dépôt de la version corrigée à un autre correcteur (403)", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/tasks/${taskId}/corrected-file`, headers: { cookie: otherCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("refuse sans session (401)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/tasks/${taskId}/manuscript-file` });
    expect(res.statusCode).toBe(401);
  });

  it("cohérence : un manuscrit CONFIÉ à l'étape Correction (sans tâche) apparaît dans Mes corrections", async () => {
    const u = `corr3_${rnd()}`;
    const user = await createUserWithRole(u, "CORRECTEUR", PWD);
    const cookie = await login(app, u);
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "CORRECTION" } });
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-CONF-${rnd()}`, title: `Confié ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    // Étape confiée nominativement (comme « Mes dossiers à traiter »), mais AUCUNE tâche.
    await prisma.manuscriptStep.create({ data: { manuscriptId: m.id, statusId: status.id, responsibleId: user.id } });
    expect(await prisma.task.count({ where: { manuscriptId: m.id, assigneeId: user.id } })).toBe(0);

    const res = await app.inject({ method: "GET", url: "/api/v1/my-corrections", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const mine = res.json().find((t: { manuscript: { id: string } | null }) => t.manuscript?.id === m.id);
    expect(mine).toBeTruthy();
    expect(mine.type).toBe("correction");
    expect(mine.title).toBe("Correction éditoriale");

    // Idempotent : un second appel ne crée pas de doublon.
    await app.inject({ method: "GET", url: "/api/v1/my-corrections", headers: { cookie } });
    expect(await prisma.task.count({ where: { manuscriptId: m.id, assigneeId: user.id, type: "correction" } })).toBe(1);
  });
});
