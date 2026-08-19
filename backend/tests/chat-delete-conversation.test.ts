import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// « Supprimer la discussion » (demande opérateur du 19/08/2026) : deux portées —
// « effacer de mon côté » (réversible, l'autre garde sa copie) et « supprimer
// pour tout le monde » (messages supprimés logiquement des deux côtés).

const PWD = "ChatDel123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("messagerie — supprimer la discussion", () => {
  let app: FastifyInstance;
  let aId: string;
  let bId: string;
  let cookieA: string;
  let cookieB: string;

  const login = async (u: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };
  const sendMsg = (cookie: string, convId: string, body: string) =>
    app.inject({ method: "POST", url: `/api/v1/chat/conversations/${convId}/messages`, headers: { cookie }, payload: { body } });
  const messages = (cookie: string, convId: string) =>
    app.inject({ method: "GET", url: `/api/v1/chat/conversations/${convId}/messages`, headers: { cookie } });
  const conversations = (cookie: string) =>
    app.inject({ method: "GET", url: "/api/v1/chat/conversations", headers: { cookie } });

  beforeAll(async () => {
    app = await buildApp();
    const uA = `cdel_a_${rnd()}`;
    const uB = `cdel_b_${rnd()}`;
    aId = (await createUserWithRole(uA, "CORRECTEUR", PWD)).id;
    bId = (await createUserWithRole(uB, "MAGASINIER", PWD)).id;
    cookieA = await login(uA);
    cookieB = await login(uB);
  });

  afterAll(async () => {
    const convs = await prisma.conversation.findMany({ where: { OR: [{ userAId: { in: [aId, bId] } }, { userBId: { in: [aId, bId] } }] } });
    const ids = convs.map((c) => c.id);
    await prisma.chatMessage.updateMany({ where: { conversationId: { in: ids } }, data: { replyToId: null } });
    await prisma.chatMessage.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversationRead.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  async function freshConversation(): Promise<string> {
    const convId = (await app.inject({ method: "POST", url: "/api/v1/chat/conversations", headers: { cookie: cookieA }, payload: { user_id: bId } })).json().id as string;
    await sendMsg(cookieA, convId, "Bonjour");
    await sendMsg(cookieB, convId, "Salut");
    return convId;
  }

  it("effacer de mon côté : la discussion disparaît pour moi, l'autre la garde", async () => {
    const convId = await freshConversation();

    const del = await app.inject({ method: "DELETE", url: `/api/v1/chat/conversations/${convId}`, headers: { cookie: cookieA }, payload: { scope: "me" } });
    expect(del.statusCode).toBe(200);
    expect(del.json().scope).toBe("me");

    // A : fil vidé + conversation absente de sa liste.
    expect((await messages(cookieA, convId)).json()).toHaveLength(0);
    expect(((await conversations(cookieA)).json() as { id: string }[]).some((c) => c.id === convId)).toBe(false);

    // B : garde ses messages et sa conversation.
    expect(((await messages(cookieB, convId)).json() as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect(((await conversations(cookieB)).json() as { id: string }[]).some((c) => c.id === convId)).toBe(true);
  });

  it("réversible : la discussion effacée réapparaît (et ne montre que les nouveaux messages) quand un message arrive", async () => {
    const convId = await freshConversation();
    await app.inject({ method: "DELETE", url: `/api/v1/chat/conversations/${convId}`, headers: { cookie: cookieA }, payload: { scope: "me" } });
    expect((await messages(cookieA, convId)).json()).toHaveLength(0);

    // B écrit un nouveau message → la discussion revient chez A…
    await sendMsg(cookieB, convId, "Tu es là ?");
    const listA = (await conversations(cookieA)).json() as { id: string }[];
    expect(listA.some((c) => c.id === convId)).toBe(true);
    // …avec UNIQUEMENT le message postérieur à l'effacement (pas l'historique).
    const msgsA = (await messages(cookieA, convId)).json() as { body: string }[];
    expect(msgsA).toHaveLength(1);
    expect(msgsA[0].body).toBe("Tu es là ?");
  });

  it("supprimer pour tout le monde : messages supprimés des deux côtés, discussion effacée pour les deux", async () => {
    const convId = await freshConversation();

    const del = await app.inject({ method: "DELETE", url: `/api/v1/chat/conversations/${convId}`, headers: { cookie: cookieB }, payload: { scope: "all" } });
    expect(del.statusCode).toBe(200);
    expect(del.json().scope).toBe("all");

    // Les messages sont supprimés logiquement (jamais effacés physiquement).
    const rows = await prisma.chatMessage.findMany({ where: { conversationId: convId } });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((m) => m.deletedAt !== null)).toBe(true);

    // Les deux : conversation absente de la liste, fil vidé.
    for (const cookie of [cookieA, cookieB]) {
      expect(((await conversations(cookie)).json() as { id: string }[]).some((c) => c.id === convId)).toBe(false);
      expect((await messages(cookie, convId)).json()).toHaveLength(0);
    }
  });

  it("refuse la suppression par un non-participant (404)", async () => {
    const convId = await freshConversation();
    const uC = `cdel_c_${rnd()}`;
    await createUserWithRole(uC, "MAGASINIER", PWD);
    const cookieC = await login(uC);
    const del = await app.inject({ method: "DELETE", url: `/api/v1/chat/conversations/${convId}`, headers: { cookie: cookieC }, payload: { scope: "me" } });
    expect(del.statusCode).toBe(404);
  });
});
