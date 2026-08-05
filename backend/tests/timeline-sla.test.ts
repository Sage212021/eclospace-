import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Frise enrichie + délais (refonte workflow) : la timeline expose l'état,
// le responsable, les dates, le temps passé, le délai cible, l'échéance et le
// retard de chaque étape.

const rnd = () => Math.random().toString(36).slice(2, 8);
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

interface TimelineRow {
  status_code: string;
  state: string;
  target_days: number | null;
  start_at: string | null;
  due_date: string | null;
  overdue: boolean;
  time_spent_days: number | null;
}

describe("frise enrichie + délais (SLA)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let manuscriptId: string;

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));

    const reception = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "RECEPTION" } });
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    // Reçu il y a 10 jours, étape RECEPTION (délai cible 2 j) → doit être en retard.
    const m = await prisma.manuscript.create({
      data: {
        manuscriptNumber: `MS-SLA-${rnd()}`,
        title: `Ouvrage SLA ${rnd()}`,
        statusId: reception.id,
        ownerId: admin.id,
        origin: "soumission",
        language: "fr",
        receivedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
    });
    manuscriptId = m.id;
  });

  afterAll(async () => {
    await prisma.manuscriptStep.deleteMany({ where: { manuscriptId } });
    await prisma.stepTransition.deleteMany({ where: { manuscriptId } });
    await prisma.manuscript.deleteMany({ where: { id: manuscriptId } });
    await app.close();
  });

  it("expose le délai cible par étape", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/timeline`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as TimelineRow[];
    const reception = rows.find((r) => r.status_code === "RECEPTION")!;
    expect(reception.target_days).toBe(2);
  });

  it("marque l'étape en cours et calcule début, échéance et retard", async () => {
    const rows = (await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/timeline`, headers: { cookie } })).json() as TimelineRow[];
    const reception = rows.find((r) => r.status_code === "RECEPTION")!;
    expect(reception.state).toBe("current");
    expect(reception.start_at).not.toBeNull();
    expect(reception.due_date).not.toBeNull();
    // Reçu il y a 10 j, délai 2 j → échéance dépassée.
    expect(reception.overdue).toBe(true);
    expect(reception.time_spent_days).toBeGreaterThanOrEqual(9);
  });

  it("les étapes non atteintes sont « à venir »", async () => {
    const rows = (await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/timeline`, headers: { cookie } })).json() as TimelineRow[];
    const impression = rows.find((r) => r.status_code === "IMPRESSION")!;
    expect(impression.state).toBe("todo");
    expect(impression.overdue).toBe(false);
  });
});
