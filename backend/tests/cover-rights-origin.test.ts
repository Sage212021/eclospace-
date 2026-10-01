import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Origine des droits de la 1re de couverture (constat opérateur « REVER EN
// AFRIQUE ») : la convergence Maquette/Infographie exige que la couverture porte
// son origine de droits. On peut la renseigner sur une couverture DÉJÀ déposée,
// sans la re-téléverser — sinon l'infographie reste bloquée.

const PWD = "Maq123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

function multipartImage(type: string, filename: string, content: string) {
  const boundary = "----ecl" + rnd();
  const body =
    `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\n${type}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n${content}\r\n` +
    `--${boundary}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body };
}

describe("origine des droits de la couverture", () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const maq = `maq_${rnd()}`;
    await createUserWithRole(maq, "MAQUETTISTE", PWD);
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: maq, password: PWD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function manuscript() {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "INFOGRAPHIE" } });
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    return prisma.manuscript.create({ data: { manuscriptNumber: `MS-RGT-${rnd()}`, title: `Droits ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() } });
  }

  it("une couverture déposée via upload image n'a pas d'origine de droits par défaut", async () => {
    const m = await manuscript();
    const mp = multipartImage("couverture_1", "couv.png", "PNGDATA");
    const up = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/image-assets/upload`, headers: { cookie, ...mp.headers }, payload: mp.body });
    expect(up.statusCode).toBe(201);
    expect(up.json().rightsOrigin ?? null).toBeNull();
  });

  it("on renseigne l'origine des droits sur la couverture déjà déposée (sans re-téléverser)", async () => {
    const m = await manuscript();
    const mp = multipartImage("couverture_1", "couv.png", "PNGDATA");
    const up = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/image-assets/upload`, headers: { cookie, ...mp.headers }, payload: mp.body });
    const assetId = up.json().id as string;

    const patch = await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${m.id}/image-assets/${assetId}/rights`, headers: { cookie }, payload: { rights_origin: "creation_interne" } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().rightsOrigin).toBe("creation_interne");

    const asset = await prisma.imageAsset.findUniqueOrThrow({ where: { id: assetId } });
    expect(asset.rightsOrigin).toBe("creation_interne");
  });

  it("refuse une origine de droits invalide (400)", async () => {
    const m = await manuscript();
    const mp = multipartImage("couverture_1", "couv.png", "PNGDATA");
    const up = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/image-assets/upload`, headers: { cookie, ...mp.headers }, payload: mp.body });
    const assetId = up.json().id as string;
    const patch = await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${m.id}/image-assets/${assetId}/rights`, headers: { cookie }, payload: { rights_origin: "n_importe_quoi" } });
    expect(patch.statusCode).toBe(400);
  });
});
