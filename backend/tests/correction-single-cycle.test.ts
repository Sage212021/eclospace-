import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// UN OUVRAGE = UN SEUL CYCLE DE CORRECTION ÉDITORIALE ACTIF (demande opérateur
// 01/10) : tant qu'une correction est ouverte (étape Correction non validée), on
// ne peut pas créer une SECONDE fiche de correction pour le même ouvrage. La
// fiche expose correctionOpen = true pendant tout le cycle.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("cycle de correction unique par ouvrage", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
  });

  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function manuscriptAtCorrection() {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "CORRECTION" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-CYC-${rnd()}`, title: `Cycle ${rnd()}`, statusId: status.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    await prisma.manuscriptStep.create({ data: { manuscriptId: m.id, statusId: status.id, responsibleId: adminId, actualStart: new Date() } });
    return m;
  }

  it("la fiche indique correctionOpen = true pendant le cycle", async () => {
    const m = await manuscriptAtCorrection();
    const fiche = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}`, headers: { cookie } });
    expect(fiche.statusCode).toBe(200);
    expect(fiche.json().correctionOpen).toBe(true);
  });

  it("refuse une SECONDE fiche de correction tant que le cycle est ouvert (409)", async () => {
    const m = await manuscriptAtCorrection();
    const res = await app.inject({
      method: "POST", url: `/api/v1/manuscripts/${m.id}/tasks`, headers: { cookie },
      payload: { title: "Correction éditoriale (bis)", type: "correction", assignee_id: adminId },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("correction_already_open");
  });

  it("autorise une tâche NON correction pendant le cycle (201)", async () => {
    const m = await manuscriptAtCorrection();
    const res = await app.inject({
      method: "POST", url: `/api/v1/manuscripts/${m.id}/tasks`, headers: { cookie },
      payload: { title: "Note interne", type: "autre", assignee_id: adminId },
    });
    expect(res.statusCode).toBe(201);
  });
});
