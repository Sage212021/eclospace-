import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Pièces jointes (demande opérateur 01/10) : le Directeur éditorial et
// l'Assistant éditorial peuvent DÉPOSER des pièces de l'ouvrage (documents:saisie),
// dont les types « CNI » et « NIU » (pièces d'identité de l'auteur).

const rnd = () => Math.random().toString(36).slice(2, 7);

describe("pièces jointes — dépôt éditorial + types CNI/NIU", () => {
  let app: FastifyInstance;
  let adminId: string;

  beforeAll(async () => {
    app = await buildApp();
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function login(u: string, p: string) {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  }
  async function manuscript() {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "RECEPTION" } });
    return prisma.manuscript.create({ data: { manuscriptNumber: `MS-PJ-${rnd()}`, title: `PJ ${rnd()}`, statusId: status.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() } });
  }

  for (const role of ["DIR_EDITORIAL", "ASSISTANT_EDITORIAL"]) {
    it(`${role} dépose une CNI (201)`, async () => {
      const u = await createUserWithRole(`${role.toLowerCase()}_${rnd()}`, role, "Pwd123!");
      const cookie = await login(u.username, "Pwd123!");
      const m = await manuscript();
      const res = await app.inject({ method: "POST", url: "/api/v1/documents", headers: { cookie }, payload: { entity_type: "manuscript", entity_id: m.id, category: "cni", title: "CNI auteur", confidentiality: "restreint" } });
      expect(res.statusCode).toBe(201);
      expect(res.json().category).toBe("cni");
    });
  }

  it("accepte le type NIU", async () => {
    const u = await createUserWithRole(`dired_${rnd()}`, "DIR_EDITORIAL", "Pwd123!");
    const cookie = await login(u.username, "Pwd123!");
    const m = await manuscript();
    const res = await app.inject({ method: "POST", url: "/api/v1/documents", headers: { cookie }, payload: { entity_type: "manuscript", entity_id: m.id, category: "niu", title: "NIU auteur", confidentiality: "restreint" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().category).toBe("niu");
  });
});
