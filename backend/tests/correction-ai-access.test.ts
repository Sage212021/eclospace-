import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// « Mes corrections » = écran complet de correction par ouvrage : le correcteur
// désigné doit pouvoir CONSULTER les relectures IA (journal + livrables/BAT
// produits) là où il les lance, sans détenir le droit large « documents » ni
// « manuscripts:consultation ». Il porte seulement le droit « tâches ».

describe("Correcteur — accès aux relectures IA depuis sa boîte", () => {
  let app: FastifyInstance;
  let correcteurCookie: string;
  let adminId: string;
  let manuscriptId: string;
  const s = Math.random().toString(36).slice(2, 7);

  const loginAs = async (username: string, password: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
    expect(r.statusCode).toBe(200);
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    await createUserWithRole(`corr_${s}`, "CORRECTEUR", "Corr123!");
    correcteurCookie = await loginAs(`corr_${s}`, "Corr123!");
    const st = await prisma.workflowStatus.findUniqueOrThrow({ where: { code: "CORRECTION" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-AI-${s}`, title: `Ouvrage IA ${s}`, language: "fr", statusId: st.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId },
    });
    manuscriptId = m.id;
  });

  afterAll(async () => {
    await prisma.manuscript.deleteMany({ where: { id: manuscriptId } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("le correcteur (droit « tâches » seul) peut lister les relectures IA d'un ouvrage", async () => {
    const r = await app.inject({ method: "GET", url: `/api/v1/ai-editorial/jobs?manuscript=${manuscriptId}`, headers: { cookie: correcteurCookie } });
    // 200 (et non 403) : la porte de lecture IA est ouverte au correcteur désigné.
    expect(r.statusCode).toBe(200);
    expect(Array.isArray(r.json().jobs)).toBe(true);
  });

  it("le rapport d'une relecture inexistante répond 404 (pas 403) pour le correcteur", async () => {
    const fakeJob = "00000000-0000-0000-0000-000000000000";
    const r = await app.inject({ method: "GET", url: `/api/v1/ai-editorial/jobs/${fakeJob}/report`, headers: { cookie: correcteurCookie } });
    // La permission passe (pas de 403) ; seul le job manque → 404.
    expect(r.statusCode).toBe(404);
  });
});
