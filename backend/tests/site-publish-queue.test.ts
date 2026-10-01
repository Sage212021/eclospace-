import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Rubrique « À publier (site) » (demande opérateur 01/10) : ouvrages arrivés à
// l'infographie, non publiés. SEUL l'infographe (production:administration) peut
// compléter la fiche (résumé/prix) et publier ; les autres consultent.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("file À publier (site)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    adminCookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function login(u: string, p: string) {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  }
  async function manuscriptAtInfographie() {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "INFOGRAPHIE" } });
    return prisma.manuscript.create({
      data: { manuscriptNumber: `MS-PUB-${rnd()}`, title: `À publier ${rnd()}`, statusId: status.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
  }

  it("liste les ouvrages arrivés à l'infographie non publiés", async () => {
    const m = await manuscriptAtInfographie();
    const res = await app.inject({ method: "GET", url: "/api/v1/site-publications/pending", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { id: string }[]).map((r) => r.id);
    expect(ids).toContain(m.id);
  });

  it("l'infographe complète la fiche (résumé + prix) ; la fiche les reflète", async () => {
    const info = await createUserWithRole(`info_${rnd()}`, "RESP_INFOGRAPHIE", "Info123!");
    const cookie = await login(info.username, "Info123!");
    const m = await manuscriptAtInfographie();
    const res = await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${m.id}/site-fiche`, headers: { cookie }, payload: { summary: "Un beau roman.", price: 4000 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().payload.summary).toBe("Un beau roman.");
    expect(res.json().payload.price).toBe(4000);
  });

  it("un NON-infographe ne peut ni compléter la fiche ni publier (403)", async () => {
    const maq = await createUserWithRole(`maq_${rnd()}`, "MAQUETTISTE", "Maq123!");
    const cookie = await login(maq.username, "Maq123!");
    const m = await manuscriptAtInfographie();
    const fiche = await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${m.id}/site-fiche`, headers: { cookie }, payload: { summary: "x" } });
    expect(fiche.statusCode).toBe(403);
    const pub = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/site-publication`, headers: { cookie }, payload: { published: true } });
    expect(pub.statusCode).toBe(403);
  });

  it("une fois publié par l'infographe, l'ouvrage sort de la file", async () => {
    const info = await createUserWithRole(`info_${rnd()}`, "RESP_INFOGRAPHIE", "Info123!");
    const cookie = await login(info.username, "Info123!");
    const m = await manuscriptAtInfographie();
    const pub = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/site-publication`, headers: { cookie }, payload: { published: true } });
    expect(pub.statusCode).toBe(200);
    const res = await app.inject({ method: "GET", url: "/api/v1/site-publications/pending", headers: { cookie: adminCookie } });
    const ids = (res.json() as { id: string }[]).map((r) => r.id);
    expect(ids).not.toContain(m.id);
  });
});
