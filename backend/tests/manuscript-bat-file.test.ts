import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Étape BAT : entrée = la maquette, sortie = le BAT signé (reçu par l'impression).
// Déposé par la qualité (bat:saisie).

const PWD = "Bat123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

async function newManuscriptAtBat() {
  const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "VALIDATION_BAT" } });
  const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  return prisma.manuscript.create({
    data: { manuscriptNumber: `MS-BAT-${rnd()}`, title: `BAT ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
  });
}

function multipart(field: string, filename: string, content: string) {
  const boundary = "----ecl" + rnd();
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body };
}

describe("Étape BAT — entrée/sortie du bon à tirer", () => {
  let app: FastifyInstance;
  let qcCookie: string;
  let maqCookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const qc = `qc_${rnd()}`;
    await createUserWithRole(qc, "RESP_QUALITE", PWD);
    qcCookie = await login(app, qc);
    // MAQUETTISTE n'a pas bat:saisie → ne peut pas déposer le BAT signé.
    const maq = `maq_${rnd()}`;
    await createUserWithRole(maq, "MAQUETTISTE", PWD);
    maqCookie = await login(app, maq);
  });

  afterAll(async () => {
    await app.close();
  });

  it("meta puis dépôt : le BAT signé devient présent et téléchargeable", async () => {
    const m = await newManuscriptAtBat();
    const before = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/bat-file/meta`, headers: { cookie: qcCookie } });
    expect(before.statusCode).toBe(200);
    expect(before.json().bat_has_file).toBe(false);

    const mp = multipart("file", "bat.pdf", "BAT signe");
    const up = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/bat-file`, headers: { cookie: qcCookie, ...mp.headers }, payload: mp.body });
    expect(up.statusCode).toBe(201);

    const after = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/bat-file/meta`, headers: { cookie: qcCookie } });
    expect(after.json().bat_has_file).toBe(true);

    const dl = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/bat-file`, headers: { cookie: qcCookie } });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toContain("BAT signe");
  });

  it("refuse le dépôt du BAT sans bat:saisie (maquettiste → 403)", async () => {
    const m = await newManuscriptAtBat();
    const mp = multipart("file", "x.pdf", "y");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/bat-file`, headers: { cookie: maqCookie, ...mp.headers }, payload: mp.body });
    expect(res.statusCode).toBe(403);
  });

  it("404 au téléchargement tant qu'aucun BAT n'est déposé", async () => {
    const m = await newManuscriptAtBat();
    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/bat-file`, headers: { cookie: qcCookie } });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("no_bat_file");
  });

  it("refuse sans session (401)", async () => {
    const m = await newManuscriptAtBat();
    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/bat-file/meta` });
    expect(res.statusCode).toBe(401);
  });
});
