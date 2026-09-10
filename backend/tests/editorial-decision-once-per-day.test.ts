import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Garde-fou : une SEULE décision éditoriale par manuscrit et par jour. Les
// décisions « révision »/« attente » laissent le dossier à l'étape décision ;
// sans ce contrôle, la même décision pouvait être rendue plusieurs fois le même
// jour (doublons dans l'historique).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

async function loginCookie(app: FastifyInstance) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("décision éditoriale — une seule par manuscrit et par jour", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;

  beforeAll(async () => {
    app = await buildApp();
    cookie = await loginCookie(app);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function manuscriptAtDecision() {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "DECISION_EDITORIALE" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-1J-${rnd()}`, title: `Une par jour ${rnd()}`, statusId: status.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    return m.id;
  }

  it("refuse une 2ᵉ décision le même jour (révision répétée)", async () => {
    const id = await manuscriptAtDecision();
    const first = await app.inject({
      method: "POST", url: `/api/v1/manuscripts/${id}/editorial-decision`, headers: { cookie },
      payload: { decision: "revision", motivation: "À retravailler." },
    });
    expect(first.statusCode).toBe(201);

    // Le dossier reste à l'étape décision (révision non terminale) → une 2ᵉ
    // décision le même jour est refusée (409 explicite).
    const again = await app.inject({
      method: "POST", url: `/api/v1/manuscripts/${id}/editorial-decision`, headers: { cookie },
      payload: { decision: "revision", motivation: "Encore." },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("decision_already_today");
    expect(again.json().message).toContain("aujourd'hui");

    // Une décision d'un AUTRE type le même jour est aussi refusée.
    const other = await app.inject({
      method: "POST", url: `/api/v1/manuscripts/${id}/editorial-decision`, headers: { cookie },
      payload: { decision: "attente", motivation: "En attente." },
    });
    expect(other.statusCode).toBe(409);
    expect(other.json().code).toBe("decision_already_today");

    // Une seule décision a été enregistrée.
    const count = await prisma.editorialDecision.count({ where: { manuscriptId: id } });
    expect(count).toBe(1);
  });

  it("autorise une nouvelle décision un autre jour", async () => {
    const id = await manuscriptAtDecision();
    const first = await app.inject({
      method: "POST", url: `/api/v1/manuscripts/${id}/editorial-decision`, headers: { cookie },
      payload: { decision: "revision", motivation: "Version 1 à revoir." },
    });
    expect(first.statusCode).toBe(201);

    // On antidate la décision d'hier : le garde-fou ne regarde qu'aujourd'hui.
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    await prisma.editorialDecision.updateMany({ where: { manuscriptId: id }, data: { decidedAt: yesterday } });

    const today = await app.inject({
      method: "POST", url: `/api/v1/manuscripts/${id}/editorial-decision`, headers: { cookie },
      payload: { decision: "acceptation", motivation: "Version révisée acceptée." },
    });
    expect(today.statusCode).toBe(201);
  });
});
