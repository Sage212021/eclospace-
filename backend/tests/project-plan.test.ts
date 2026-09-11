import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie, createUserWithRole } from "./helpers.js";

// Planification du projet : le planning est saisi et lié au manuscrit, puis
// relu ; l'enregistrement incrémente la version et remplace les activités.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string, p: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

describe("planification du projet — planning lié au manuscrit", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login(app, "admin", ADMIN_PASSWORD);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function manuscriptAtPlanification() {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "PLANIFICATION" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-PLAN-${rnd()}`, title: `Projet ${rnd()}`, statusId: status.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    return m.id;
  }

  it("enregistre puis relit le planning ; la version s'incrémente", async () => {
    const id = await manuscriptAtPlanification();

    // Vide au départ.
    const empty = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${id}/project-plan`, headers: { cookie } });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toBeNull();

    const save1 = await app.inject({
      method: "PUT", url: `/api/v1/manuscripts/${id}/project-plan`, headers: { cookie },
      payload: {
        manager_name: "Noah Mbala",
        start_date: "2026-08-21",
        end_date: "2026-12-05",
        objectives: "Publier l'ouvrage",
        activities: [
          { label: "Ajustement de la couverture", responsible: "Infographie", start_date: "2026-08-21", end_date: "2026-08-28", priority: "haute", status: "en_cours" },
          { label: "Travail de l'auteur", start_date: "2026-08-21", end_date: "2026-09-30", priority: "normale", status: "a_faire" },
        ],
      },
    });
    expect(save1.statusCode).toBe(200);
    expect(save1.json().version).toBe(1);
    expect(save1.json().activities.length).toBe(2);
    expect(save1.json().activities[0].label).toBe("Ajustement de la couverture");

    // 2ᵉ enregistrement : remplace les activités et incrémente la version.
    const save2 = await app.inject({
      method: "PUT", url: `/api/v1/manuscripts/${id}/project-plan`, headers: { cookie },
      payload: { manager_name: "Noah Mbala", activities: [{ label: "Lancement impression", priority: "haute", status: "a_faire" }] },
    });
    expect(save2.statusCode).toBe(200);
    expect(save2.json().version).toBe(2);
    expect(save2.json().activities.length).toBe(1);
    expect(save2.json().activities[0].label).toBe("Lancement impression");

    // Relecture cohérente.
    const reread = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${id}/project-plan`, headers: { cookie } });
    expect(reread.json().version).toBe(2);
    expect(reread.json().activities.length).toBe(1);
  });

  it("refuse l'enregistrement sans droit de saisie manuscrits (403)", async () => {
    const id = await manuscriptAtPlanification();
    await createUserWithRole(`corr_plan_${rnd()}`, "CORRECTEUR", "Plan123!");
    // Un correcteur n'a pas manuscripts:saisie.
    const u = (await prisma.user.findFirst({ where: { username: { startsWith: "corr_plan_" } }, orderBy: { createdAt: "desc" } }))!;
    const c = await login(app, u.username, "Plan123!");
    const res = await app.inject({ method: "PUT", url: `/api/v1/manuscripts/${id}/project-plan`, headers: { cookie: c }, payload: { activities: [] } });
    expect(res.statusCode).toBe(403);
  });
});
