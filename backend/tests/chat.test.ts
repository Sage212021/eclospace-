import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Messagerie interne 1-à-1 : conversation unique par paire, envoi/réception,
// non-lus, pièce jointe, confidentialité (non-participant refusé) et supervision
// tracée de la Direction.

const PWD = "Chat123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

function multipartFile(filename: string, contentType: string, content: Buffer) {
  const boundary = "----ecl" + Math.random().toString(36).slice(2);
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, content, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("messagerie interne (chat 1-à-1)", () => {
  let app: FastifyInstance;
  let aId: string;
  let bId: string;
  let cookieA: string;
  let cookieB: string;
  let cookieC: string; // non-participant
  let cookieDir: string; // Direction

  const login = async (u: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    const uA = `chat_a_${rnd()}`;
    const uB = `chat_b_${rnd()}`;
    const uC = `chat_c_${rnd()}`;
    const uDir = `chat_dir_${rnd()}`;
    const a = await createUserWithRole(uA, "CORRECTEUR", PWD);
    const b = await createUserWithRole(uB, "MAGASINIER", PWD);
    await createUserWithRole(uC, "MAGASINIER", PWD);
    await createUserWithRole(uDir, "DIR_GENERAL", PWD);
    aId = a.id;
    bId = b.id;
    cookieA = await login(uA);
    cookieB = await login(uB);
    cookieC = await login(uC);
    cookieDir = await login(uDir);
  });

  afterAll(async () => {
    const convs = await prisma.conversation.findMany({ where: { OR: [{ userAId: aId }, { userBId: aId }] } });
    const ids = convs.map((c) => c.id);
    await prisma.chatMessage.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversationRead.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  let convId: string;

  it("annuaire : liste les collègues sans soi-même", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/chat/directory", headers: { cookie: cookieA } });
    expect(res.statusCode).toBe(200);
    const dir = res.json() as { id: string }[];
    expect(dir.some((d) => d.id === bId)).toBe(true);
    expect(dir.some((d) => d.id === aId)).toBe(false);
  });

  it("une seule conversation par paire (idempotent)", async () => {
    const r1 = await app.inject({ method: "POST", url: "/api/v1/chat/conversations", headers: { cookie: cookieA }, payload: { user_id: bId } });
    expect(r1.statusCode).toBe(201);
    convId = r1.json().id;
    // B initie de son côté : même conversation.
    const r2 = await app.inject({ method: "POST", url: "/api/v1/chat/conversations", headers: { cookie: cookieB }, payload: { user_id: aId } });
    expect(r2.json().id).toBe(convId);
  });

  it("envoi/réception d'un message texte, non-lus puis lecture", async () => {
    const send = await app.inject({ method: "POST", url: `/api/v1/chat/conversations/${convId}/messages`, headers: { cookie: cookieA }, payload: { body: "Bonjour !" } });
    expect(send.statusCode).toBe(201);
    expect(send.json().body).toBe("Bonjour !");

    const unread = await app.inject({ method: "GET", url: "/api/v1/chat/unread", headers: { cookie: cookieB } });
    expect(unread.json().unread).toBe(1);

    const msgs = await app.inject({ method: "GET", url: `/api/v1/chat/conversations/${convId}/messages`, headers: { cookie: cookieB } });
    expect(msgs.json()).toHaveLength(1);

    await app.inject({ method: "POST", url: `/api/v1/chat/conversations/${convId}/read`, headers: { cookie: cookieB } });
    const unread2 = await app.inject({ method: "GET", url: "/api/v1/chat/unread", headers: { cookie: cookieB } });
    expect(unread2.json().unread).toBe(0);
  });

  it("pièce jointe : envoi multipart puis téléchargement", async () => {
    const mp = multipartFile("note.txt", "text/plain", Buffer.from("contenu de test"));
    const send = await app.inject({ method: "POST", url: `/api/v1/chat/conversations/${convId}/messages`, headers: { cookie: cookieA, "content-type": mp.contentType }, payload: mp.body });
    expect(send.statusCode).toBe(201);
    const msg = send.json();
    expect(msg.file).toMatchObject({ name: "note.txt" });

    const dl = await app.inject({ method: "GET", url: `/api/v1/chat/messages/${msg.id}/file`, headers: { cookie: cookieB } });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toContain("contenu de test");
  });

  it("confidentialité : un non-participant est refusé (403)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/chat/conversations/${convId}/messages`, headers: { cookie: cookieC } });
    expect(res.statusCode).toBe(403);
  });

  it("supervision : la Direction peut consulter, l'accès est tracé", async () => {
    const before = await prisma.auditLog.count({ where: { entityType: "conversation_supervision", entityId: convId } });
    const res = await app.inject({ method: "GET", url: `/api/v1/chat/conversations/${convId}/messages`, headers: { cookie: cookieDir } });
    expect(res.statusCode).toBe(200);
    const after = await prisma.auditLog.count({ where: { entityType: "conversation_supervision", entityId: convId } });
    expect(after).toBe(before + 1);
  });

  it("suppression logique de son propre message", async () => {
    const send = await app.inject({ method: "POST", url: `/api/v1/chat/conversations/${convId}/messages`, headers: { cookie: cookieA }, payload: { body: "à supprimer" } });
    const id = send.json().id;
    const del = await app.inject({ method: "DELETE", url: `/api/v1/chat/messages/${id}`, headers: { cookie: cookieA } });
    expect(del.statusCode).toBe(200);
    // B ne peut pas supprimer un message de A.
    const send2 = await app.inject({ method: "POST", url: `/api/v1/chat/conversations/${convId}/messages`, headers: { cookie: cookieA }, payload: { body: "protégé" } });
    const del2 = await app.inject({ method: "DELETE", url: `/api/v1/chat/messages/${send2.json().id}`, headers: { cookie: cookieB } });
    expect(del2.statusCode).toBe(403);
  });
});
