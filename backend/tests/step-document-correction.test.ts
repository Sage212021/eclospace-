import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Correction d'un fichier déposé par erreur à une étape (demande opérateur
// 21/08/2026) : l'auteur du dépôt et la direction peuvent le RETIRER (suppression
// logique) ; on peut toujours en redéposer un autre.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

function multipart(field: string, filename: string, content: string) {
  const boundary = "----ecl" + rnd();
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body };
}

async function login(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("correction d'un fichier d'étape déposé par erreur", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let maquettisteCookie: string;
  let manuscriptId: string;

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login(app, "admin", ADMIN_PASSWORD);
    const maq = `maq_corr_${rnd()}`;
    await createUserWithRole(maq, "MAQUETTISTE", "MaqCorr123!");
    maquettisteCookie = await login(app, maq, "MaqCorr123!");

    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "MISE_EN_PAGE" } });
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-DOC-${rnd()}`, title: `Doc ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    manuscriptId = m.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("un tiers (ni auteur ni direction) ne peut pas retirer ; la direction, oui", async () => {
    // L'admin (direction) dépose une pièce d'étape.
    const mp = multipart("file", "scan.txt", "Scan déposé.");
    const up = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/step-attachments`, headers: { cookie: adminCookie, ...mp.headers }, payload: mp.body });
    expect(up.statusCode).toBe(201);
    const docId = up.json().id as string;

    // Le maquettiste (ni auteur, ni direction) ne peut pas le retirer.
    const refused = await app.inject({ method: "DELETE", url: `/api/v1/manuscripts/${manuscriptId}/step-documents/${docId}`, headers: { cookie: maquettisteCookie } });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe("forbidden");

    // La direction (admin) peut le retirer.
    const removed = await app.inject({ method: "DELETE", url: `/api/v1/manuscripts/${manuscriptId}/step-documents/${docId}`, headers: { cookie: adminCookie } });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().removed).toBe(true);

    // Il ne figure plus dans la liste (suppression logique).
    const list = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/step-attachments`, headers: { cookie: adminCookie } });
    expect((list.json() as { id: string }[]).some((d) => d.id === docId)).toBe(false);
  });

  it("l'auteur du dépôt peut retirer son propre fichier, puis en redéposer un", async () => {
    // Le maquettiste dépose une maquette.
    const mp = multipart("file", "maquette.txt", "Maquette v1.");
    const up = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/layout-file`, headers: { cookie: maquettisteCookie, ...mp.headers }, payload: mp.body });
    expect(up.statusCode).toBe(201);

    const meta = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/layout-file/meta`, headers: { cookie: maquettisteCookie } });
    expect(meta.json().layout_has_file).toBe(true);
    expect(meta.json().layout_can_correct).toBe(true);
    const docId = meta.json().layout_doc_id as string;

    // Il retire sa maquette déposée par erreur.
    const removed = await app.inject({ method: "DELETE", url: `/api/v1/manuscripts/${manuscriptId}/step-documents/${docId}`, headers: { cookie: maquettisteCookie } });
    expect(removed.statusCode).toBe(200);

    const meta2 = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/layout-file/meta`, headers: { cookie: maquettisteCookie } });
    expect(meta2.json().layout_has_file).toBe(false);

    // Il peut aussitôt redéposer la bonne maquette.
    const mp2 = multipart("file", "maquette.txt", "Maquette corrigée.");
    const up2 = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/layout-file`, headers: { cookie: maquettisteCookie, ...mp2.headers }, payload: mp2.body });
    expect(up2.statusCode).toBe(201);
  });

  it("un visuel (infographie) déposé par erreur peut être retiré", async () => {
    const create = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/image-assets`, headers: { cookie: adminCookie }, payload: { type: "illustration_interieure", resolution_dpi: 300, color_mode: "cmjn", rights_origin: "creation_interne" } });
    expect(create.statusCode).toBe(201);
    const assetId = create.json().id as string;

    const removed = await app.inject({ method: "DELETE", url: `/api/v1/manuscripts/${manuscriptId}/image-assets/${assetId}`, headers: { cookie: adminCookie } });
    expect(removed.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/image-assets`, headers: { cookie: adminCookie } });
    expect((list.json() as { id: string }[]).some((a) => a.id === assetId)).toBe(false);
  });
});
