import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Options de la messagerie (demande opérateur du 02/08/2026) :
// « Répondre / citer », « Modifier », « Transférer ».

const PWD = "Chat123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("messagerie — répondre, modifier, transférer", () => {
  let app: FastifyInstance;
  let aId: string;
  let bId: string;
  let cId: string;
  let cookieA: string;
  let cookieB: string;

  const login = async (u: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    const uA = `cact_a_${rnd()}`;
    const uB = `cact_b_${rnd()}`;
    const uC = `cact_c_${rnd()}`;
    aId = (await createUserWithRole(uA, "CORRECTEUR", PWD)).id;
    bId = (await createUserWithRole(uB, "MAGASINIER", PWD)).id;
    cId = (await createUserWithRole(uC, "MAGASINIER", PWD)).id;
    cookieA = await login(uA);
    cookieB = await login(uB);
  });

  afterAll(async () => {
    const convs = await prisma.conversation.findMany({ where: { OR: [{ userAId: { in: [aId, bId, cId] } }, { userBId: { in: [aId, bId, cId] } }] } });
    const ids = convs.map((c) => c.id);
    // Les réponses citées créent une auto-référence : détacher avant suppression.
    await prisma.chatMessage.updateMany({ where: { conversationId: { in: ids } }, data: { replyToId: null } });
    await prisma.chatMessage.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversationRead.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  let convId: string;
  let firstMsgId: string;

  it("prépare une conversation et un premier message", async () => {
    convId = (await app.inject({ method: "POST", url: "/api/v1/chat/conversations", headers: { cookie: cookieA }, payload: { user_id: bId } })).json().id;
    const send = await app.inject({ method: "POST", url: `/api/v1/chat/conversations/${convId}/messages`, headers: { cookie: cookieA }, payload: { body: "Question initiale" } });
    firstMsgId = send.json().id;
    expect(send.statusCode).toBe(201);
  });

  it("Répondre : le message cite bien l'original", async () => {
    const reply = await app.inject({
      method: "POST",
      url: `/api/v1/chat/conversations/${convId}/messages`,
      headers: { cookie: cookieB },
      payload: { body: "Voici ma réponse", reply_to_id: firstMsgId },
    });
    expect(reply.statusCode).toBe(201);
    expect(reply.json().reply_to).toMatchObject({ id: firstMsgId, excerpt: "Question initiale" });
  });

  it("Répondre : refuse un message cité hors de la conversation", async () => {
    const reply = await app.inject({
      method: "POST",
      url: `/api/v1/chat/conversations/${convId}/messages`,
      headers: { cookie: cookieB },
      payload: { body: "hors sujet", reply_to_id: "00000000-0000-0000-0000-000000000000" },
    });
    expect(reply.statusCode).toBe(400);
  });

  it("Modifier : l'auteur change son texte, le message est marqué modifié", async () => {
    const edit = await app.inject({ method: "PATCH", url: `/api/v1/chat/messages/${firstMsgId}`, headers: { cookie: cookieA }, payload: { body: "Question corrigée" } });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().body).toBe("Question corrigée");
    expect(edit.json().edited).toBe(true);
  });

  it("Modifier : un tiers ne peut pas modifier le message d'autrui (403)", async () => {
    const edit = await app.inject({ method: "PATCH", url: `/api/v1/chat/messages/${firstMsgId}`, headers: { cookie: cookieB }, payload: { body: "tentative" } });
    expect(edit.statusCode).toBe(403);
  });

  it("Transférer : recopie le message vers un autre collègue, marqué « transféré »", async () => {
    const fwd = await app.inject({ method: "POST", url: `/api/v1/chat/messages/${firstMsgId}/forward`, headers: { cookie: cookieA }, payload: { to_user_id: cId } });
    expect(fwd.statusCode).toBe(201);
    expect(fwd.json().forwarded).toBe(true);
    expect(fwd.json().body).toBe("Question corrigée");
    expect(fwd.json().other_id).toBe(cId);
  });

  it("Transférer : refuse de se transférer à soi-même", async () => {
    const fwd = await app.inject({ method: "POST", url: `/api/v1/chat/messages/${firstMsgId}/forward`, headers: { cookie: cookieA }, payload: { to_user_id: aId } });
    expect(fwd.statusCode).toBe(400);
  });
});
