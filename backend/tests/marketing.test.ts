import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { prisma } = await import("../src/lib/prisma.js");
const { createUserWithRole, extractSessionCookie } = await import("./helpers.js");

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

// Fiche marketing par ouvrage (Pôle Marketing, Communication & Distribution).
describe("Fiche marketing par ouvrage (D-031)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let manuscriptId: string;
  let planId: string;
  const s = Math.random().toString(36).slice(2, 6);

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login("admin", ADMIN_PASSWORD);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const status = await prisma.workflowStatus.findFirstOrThrow();
    const ms = await prisma.manuscript.create({ data: { manuscriptNumber: `MKT-${s}`, title: `Ouvrage MKT ${s}`, language: "fr", statusId: status.id, ownerId: adminId, receivedAt: new Date() } });
    manuscriptId = ms.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("crée la fiche (positionnement) puis la relit", async () => {
    const put = await app.inject({ method: "PUT", url: `/api/v1/marketing/manuscripts/${manuscriptId}/plan`, headers: { cookie: adminCookie }, payload: { public_cible: "Entrepreneurs", argumentaire: "Guide pratique." } });
    expect(put.statusCode).toBe(200);
    planId = put.json().id;
    expect(planId).toBeTruthy();

    const get = await app.inject({ method: "GET", url: `/api/v1/marketing/manuscripts/${manuscriptId}/plan`, headers: { cookie: adminCookie } });
    expect(get.statusCode).toBe(200);
    expect(get.json().plan.public_cible).toBe("Entrepreneurs");
    expect(get.json().manuscript.title).toContain("Ouvrage MKT");
  });

  it("ajoute des actions et agrège le budget dans la liste", async () => {
    for (const [action, prevu, engage] of [["Campagne lancement", 50000, 20000], ["Communiqué presse", 0, 0]] as const) {
      const r = await app.inject({ method: "POST", url: `/api/v1/marketing/plans/${planId}/actions`, headers: { cookie: adminCookie }, payload: { canal: "reseaux_sociaux", action, budget_prevu: prevu, budget_engage: engage } });
      expect(r.statusCode).toBe(201);
    }
    const list = await app.inject({ method: "GET", url: "/api/v1/marketing/plans", headers: { cookie: adminCookie } });
    const mine = (list.json().items as { manuscript: { id: string }; actions_total: number; budget_prevu: number; budget_engage: number }[]).find((p) => p.manuscript.id === manuscriptId)!;
    expect(mine.actions_total).toBe(2);
    expect(mine.budget_prevu).toBe(50000);
    expect(mine.budget_engage).toBe(20000);
  });

  it("modifie puis retire une action (suppression logique)", async () => {
    const get = await app.inject({ method: "GET", url: `/api/v1/marketing/manuscripts/${manuscriptId}/plan`, headers: { cookie: adminCookie } });
    const actionId = (get.json().plan.actions as { id: string }[])[0].id;
    const patch = await app.inject({ method: "PATCH", url: `/api/v1/marketing/actions/${actionId}`, headers: { cookie: adminCookie }, payload: { statut: "fait" } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().statut).toBe("fait");

    const del = await app.inject({ method: "DELETE", url: `/api/v1/marketing/actions/${actionId}`, headers: { cookie: adminCookie } });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: `/api/v1/marketing/manuscripts/${manuscriptId}/plan`, headers: { cookie: adminCookie } });
    expect((after.json().plan.actions as unknown[]).length).toBe(1);
  });

  it("refuse l'écriture à un profil sans marketing:saisie (403)", async () => {
    await createUserWithRole(`mkt_plain_${s}`, "CORRECTEUR", "Correcteur123!");
    const cookie = await login(`mkt_plain_${s}`, "Correcteur123!");
    const res = await app.inject({ method: "PUT", url: `/api/v1/marketing/manuscripts/${manuscriptId}/plan`, headers: { cookie }, payload: { public_cible: "X" } });
    expect(res.statusCode).toBe(403);
  });
});
