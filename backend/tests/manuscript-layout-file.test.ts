import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Étape Maquette : entrée = manuscrit corrigé, sortie = maquette mise en page
// (reçue par le BAT/infographie). Déposée par la production (production:saisie).

const PWD = "Maq123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

async function newManuscriptAtLayout() {
  const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "MISE_EN_PAGE" } });
  const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  return prisma.manuscript.create({
    data: { manuscriptNumber: `MS-MAQ-${rnd()}`, title: `Maquette ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
  });
}

function multipart(field: string, filename: string, content: string) {
  const boundary = "----ecl" + rnd();
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body };
}

describe("Étape Maquette — entrée/sortie de la mise en page", () => {
  let app: FastifyInstance;
  let maqCookie: string;
  let corrCookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const maq = `maq_${rnd()}`;
    await createUserWithRole(maq, "MAQUETTISTE", PWD);
    maqCookie = await login(app, maq);
    // CORRECTEUR n'a pas production:saisie → ne peut pas déposer de maquette.
    const corr = `corr_${rnd()}`;
    await createUserWithRole(corr, "CORRECTEUR", PWD);
    corrCookie = await login(app, corr);
  });

  afterAll(async () => {
    await app.close();
  });

  it("meta : sans dépôt, ni corrigé ni maquette ; après dépôt, la maquette est présente", async () => {
    const m = await newManuscriptAtLayout();
    const before = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/layout-file/meta`, headers: { cookie: maqCookie } });
    expect(before.statusCode).toBe(200);
    expect(before.json().corrected_has_file).toBe(false);
    expect(before.json().layout_has_file).toBe(false);

    const mp = multipart("file", "maquette.pdf", "PDF maquette");
    const up = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/layout-file`, headers: { cookie: maqCookie, ...mp.headers }, payload: mp.body });
    expect(up.statusCode).toBe(201);

    const after = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/layout-file/meta`, headers: { cookie: maqCookie } });
    expect(after.json().layout_has_file).toBe(true);

    const dl = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/layout-file`, headers: { cookie: maqCookie } });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toContain("PDF maquette");
  });

  it("entrée : 404 tant qu'aucun manuscrit corrigé n'est déposé", async () => {
    const m = await newManuscriptAtLayout();
    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/corrected-file`, headers: { cookie: maqCookie } });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("no_corrected_file");
  });

  it("refuse le dépôt de maquette sans production:saisie (correcteur → 403)", async () => {
    const m = await newManuscriptAtLayout();
    const mp = multipart("file", "x.pdf", "y");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/layout-file`, headers: { cookie: corrCookie, ...mp.headers }, payload: mp.body });
    expect(res.statusCode).toBe(403);
  });

  it("refuse sans session (401)", async () => {
    const m = await newManuscriptAtLayout();
    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/layout-file/meta` });
    expect(res.statusCode).toBe(401);
  });
});
