import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Lancement IA : bouton « Stopper » (annulation) + balayage des jobs restés
// « en cours » anormalement longtemps (serveur redémarré) pour éviter un statut
// perpétuel et des relances qui consomment le crédit.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("relecture IA — arrêt & jobs bloqués", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let manuscriptId: string;

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const st = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "CORRECTION" } });
    const m = await prisma.manuscript.create({ data: { manuscriptNumber: `MS-AIJOB-${rnd()}`, title: `AiJob ${rnd()}`, language: "fr", statusId: st.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } });
    manuscriptId = m.id;
  });

  afterAll(async () => {
    await prisma.aiReadingJob.deleteMany({ where: { manuscriptId } }).catch(() => {});
    await prisma.manuscript.deleteMany({ where: { id: manuscriptId } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  const mkJob = (status: "en_cours" | "termine", launchedAt: Date) =>
    prisma.aiReadingJob.create({ data: { manuscriptId, workType: "correction_1", promptKey: "correction_1", promptVersion: 1, model: "claude-haiku-4-5", status, launchedBy: adminId, launchedAt } });

  it("arrête un lancement en cours (« Stopper ») → statut annulé", async () => {
    const job = await mkJob("en_cours", new Date());
    const r = await app.inject({ method: "POST", url: `/api/v1/ai-editorial/jobs/${job.id}/cancel`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect((await prisma.aiReadingJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("annule");
  });

  it("refuse d'arrêter un lancement déjà terminé", async () => {
    const job = await mkJob("termine", new Date());
    const r = await app.inject({ method: "POST", url: `/api/v1/ai-editorial/jobs/${job.id}/cancel`, headers: { cookie } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("not_cancellable");
  });

  it("balaie un job resté « en cours » trop longtemps → marqué en erreur à la lecture", async () => {
    const old = new Date(Date.now() - 30 * 60 * 1000); // 30 min
    const job = await mkJob("en_cours", old);
    const list = await app.inject({ method: "GET", url: `/api/v1/ai-editorial/jobs?manuscript=${manuscriptId}`, headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const row = (list.json().jobs as Array<{ id: string; status: string }>).find((j) => j.id === job.id);
    expect(row?.status).toBe("erreur");
  });

  it("ne balaie PAS un job récent (encore en cours)", async () => {
    const job = await mkJob("en_cours", new Date());
    const list = await app.inject({ method: "GET", url: `/api/v1/ai-editorial/jobs?manuscript=${manuscriptId}`, headers: { cookie } });
    const row = (list.json().jobs as Array<{ id: string; status: string }>).find((j) => j.id === job.id);
    expect(row?.status).toBe("en_cours");
  });
});
