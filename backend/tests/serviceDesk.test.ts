import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Messagerie auteur ↔ services (inc. 2b) : création/réponse, isolation stricte
// (un auteur ne voit que ses fils), et garde de permission côté personnel.

const PWD = "ServiceTest123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("Messagerie services (Espace Auteur inc. 2b)", () => {
  let app: FastifyInstance;
  let cookieA = "";
  let cookieB = "";
  let cookieEmp = "";
  let cookieAdmin = "";
  const partnerIds: string[] = [];

  const login = async (u: string, p = PWD) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  async function makeAuthor(tag: string) {
    const partner = await prisma.partner.create({ data: { category: "auteur", firstName: tag, lastName: "Svc", email: `${tag}svc@ex.test` } });
    const user = await prisma.user.create({
      data: { username: `svc_${tag}`, email: `${tag}svc@ex.test`, passwordHash: await argon2.hash(PWD), status: "active", accountType: "external", partnerId: partner.id },
    });
    partnerIds.push(partner.id);
    return { partner, user };
  }

  beforeAll(async () => {
    app = await buildApp();
    const a = await makeAuthor(`a${rnd()}`);
    const b = await makeAuthor(`b${rnd()}`);
    const empUser = `emp_${rnd()}`;
    await createUserWithRole(empUser, "CORRECTEUR", PWD);
    cookieA = await login(a.user.username);
    cookieB = await login(b.user.username);
    cookieEmp = await login(empUser);
    cookieAdmin = await login("admin", "TestAdmin123!");
  });

  afterAll(async () => {
    const threads = await prisma.serviceThread.findMany({ where: { partnerId: { in: partnerIds } }, select: { id: true } });
    const ids = threads.map((t) => t.id);
    await prisma.serviceMessage.deleteMany({ where: { threadId: { in: ids } } });
    await prisma.serviceThread.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  let threadAId = "";

  it("l'auteur écrit à un service et retrouve son fil", async () => {
    const create = await app.inject({ method: "POST", url: "/api/v1/author/service-threads", headers: { cookie: cookieA }, payload: { service: "education", subject: "Question pédagogique", body: "Bonjour, une question sur l'usage scolaire." } });
    expect(create.statusCode).toBe(201);
    threadAId = create.json().id;

    const list = await app.inject({ method: "GET", url: "/api/v1/author/service-threads", headers: { cookie: cookieA } });
    const threads = list.json() as { id: string; service: string; subject: string }[];
    expect(threads).toHaveLength(1);
    expect(threads[0].service).toBe("education");
  });

  it("un auteur ne voit pas le fil d'un autre auteur (404)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/author/service-threads/${threadAId}`, headers: { cookie: cookieB } });
    expect(res.statusCode).toBe(404);
  });

  it("le personnel habilité voit le fil, filtre par service et répond", async () => {
    const list = await app.inject({ method: "GET", url: "/api/v1/service-threads?service=education", headers: { cookie: cookieAdmin } });
    expect(list.statusCode).toBe(200);
    const found = (list.json() as { id: string; author_name: string }[]).find((t) => t.id === threadAId);
    expect(found).toBeTruthy();

    const reply = await app.inject({ method: "POST", url: `/api/v1/service-threads/${threadAId}/messages`, headers: { cookie: cookieAdmin }, payload: { body: "Bonjour, voici notre réponse." } });
    expect(reply.statusCode).toBe(201);
  });

  it("l'auteur voit la réponse du service (message marqué du service)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/author/service-threads/${threadAId}`, headers: { cookie: cookieA } });
    expect(res.statusCode).toBe(200);
    const msgs = res.json().messages as { from_service: boolean }[];
    expect(msgs.some((m) => m.from_service)).toBe(true);
  });

  it("un employé sans droit service_auteurs n'accède pas aux guichets (403)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/service-threads", headers: { cookie: cookieEmp } });
    expect(res.statusCode).toBe(403);
  });

  it("un auteur n'accède pas au guichet personnel (403)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/service-threads", headers: { cookie: cookieA } });
    expect(res.statusCode).toBe(403);
  });

  it("un sujet ou un message vide est refusé (400)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/author/service-threads", headers: { cookie: cookieA }, payload: { service: "client", subject: "", body: "" } });
    expect(res.statusCode).toBe(400);
  });
});
