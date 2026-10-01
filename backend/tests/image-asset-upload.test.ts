import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Dépôt d'un visuel AVEC son image (demande opérateur 01/10/2026) : l'infographe
// téléverse la 1ère de couverture (image) qui alimente le site. Fichier réel,
// servi ensuite pour l'aperçu. Les non-images sont refusées.

const PWD = "Maq123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

function multipartImage(type: string, filename: string, content: string, contentType = "image/png") {
  const boundary = "----ecl" + rnd();
  const body =
    `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\n${type}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n${content}\r\n` +
    `--${boundary}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body };
}

describe("Dépôt d'image de couverture (visuel)", () => {
  let app: FastifyInstance;
  let maqCookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const maq = `maq_${rnd()}`;
    await createUserWithRole(maq, "MAQUETTISTE", PWD);
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: maq, password: PWD } });
    maqCookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function manuscriptAtLayout() {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "MISE_EN_PAGE" } });
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    return prisma.manuscript.create({
      data: { manuscriptNumber: `MS-IMG-${rnd()}`, title: `Visuel ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
  }

  it("téléverse une 1ère de couverture : visuel avec fichier, servi pour l'aperçu", async () => {
    const m = await manuscriptAtLayout();
    const mp = multipartImage("couverture_1", "couv.png", "PNGDATA");
    const up = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/image-assets/upload`, headers: { cookie: maqCookie, ...mp.headers }, payload: mp.body });
    expect(up.statusCode).toBe(201);
    expect(up.json().has_file).toBe(true);

    const list = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/image-assets`, headers: { cookie: maqCookie } });
    const cover = list.json().find((a: { type: string; has_file: boolean }) => a.type === "couverture_1");
    expect(cover?.has_file).toBe(true);

    const file = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/image-assets/${cover.id}/file`, headers: { cookie: maqCookie } });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toContain("image/");
    expect(file.body).toContain("PNGDATA");
  });

  it("refuse un fichier qui n'est pas une image (400)", async () => {
    const m = await manuscriptAtLayout();
    const mp = multipartImage("couverture_1", "notes.txt", "pas une image", "text/plain");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/image-assets/upload`, headers: { cookie: maqCookie, ...mp.headers }, payload: mp.body });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("not_an_image");
  });

  it("un nouveau dépôt du même type remplace l'ancien (un seul visuel actif)", async () => {
    const m = await manuscriptAtLayout();
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/image-assets/upload`, headers: { cookie: maqCookie, ...multipartImage("couverture_1", "a.png", "A").headers }, payload: multipartImage("couverture_1", "a.png", "A").body });
    const mp2 = multipartImage("couverture_1", "b.png", "B");
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/image-assets/upload`, headers: { cookie: maqCookie, ...mp2.headers }, payload: mp2.body });
    const list = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/image-assets`, headers: { cookie: maqCookie } });
    const covers = list.json().filter((a: { type: string }) => a.type === "couverture_1");
    expect(covers.length).toBe(1);
  });
});
