import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Dépôt à la réception : le fichier source du manuscrit, déposé par le
// secrétariat éditorial (manuscripts:saisie) sans le droit large « documents ».
// C'est l'entrée du circuit, lue ensuite par la lecture puis la correction.

const PWD = "Sec123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

async function newManuscript() {
  const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "RECEPTION" } });
  const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  return prisma.manuscript.create({
    data: { manuscriptNumber: `MS-SRC-${rnd()}`, title: `Source ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
  });
}

// Corps multipart minimal pour app.inject.
function multipart(field: string, filename: string, content: string) {
  const boundary = "----ecl" + rnd();
  const body =
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
    `Content-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body };
}

describe("Dépôt du manuscrit source à la réception", () => {
  let app: FastifyInstance;
  let secCookie: string;
  let readerCookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const sec = `sec_${rnd()}`;
    await createUserWithRole(sec, "ASSISTANT_EDITORIAL", PWD);
    secCookie = await login(app, sec);
    const reader = `lec_${rnd()}`;
    await createUserWithRole(reader, "MEMBRE_COMITE_LECTURE", PWD);
    readerCookie = await login(app, reader);
  });

  afterAll(async () => {
    await app.close();
  });

  it("meta indique l'absence de fichier au départ, puis sa présence après dépôt", async () => {
    const m = await newManuscript();
    const before = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/source-file/meta`, headers: { cookie: secCookie } });
    expect(before.statusCode).toBe(200);
    expect(before.json().has_file).toBe(false);

    const mp = multipart("file", "manuscrit.txt", "Contenu du manuscrit.");
    const up = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/source-file`, headers: { cookie: secCookie, ...mp.headers }, payload: mp.body });
    expect(up.statusCode).toBe(201);
    expect(up.json().has_file).toBe(true);

    const after = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/source-file/meta`, headers: { cookie: secCookie } });
    expect(after.json().has_file).toBe(true);

    // Le fichier déposé est téléchargeable.
    const dl = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/source-file`, headers: { cookie: secCookie } });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toContain("Contenu du manuscrit.");
  });

  it("un rôle sans manuscripts:saisie ne peut pas déposer (relecteur → 403)", async () => {
    const m = await newManuscript();
    const mp = multipart("file", "x.txt", "y");
    const up = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/source-file`, headers: { cookie: readerCookie, ...mp.headers }, payload: mp.body });
    expect(up.statusCode).toBe(403);
  });

  it("404 au téléchargement tant qu'aucun fichier n'est déposé", async () => {
    const m = await newManuscript();
    const dl = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/source-file`, headers: { cookie: secCookie } });
    expect(dl.statusCode).toBe(404);
    expect(dl.json().code).toBe("no_source_file");
  });

  it("refuse sans session (401)", async () => {
    const m = await newManuscript();
    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/source-file/meta` });
    expect(res.statusCode).toBe(401);
  });

  it("pièces d'étape : dépôt libre de fichiers/scans, listés et téléchargeables", async () => {
    const m = await newManuscript();
    // Rien au départ.
    const empty = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/step-attachments`, headers: { cookie: secCookie } });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toHaveLength(0);

    // Dépôt d'un fichier avec le libellé de l'étape.
    const mp = multipart("file", "fiche-technique.txt", "Contenu de la fiche technique.");
    const up = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${m.id}/step-attachments?step_label=${encodeURIComponent("Mise en page")}`,
      headers: { cookie: secCookie, ...mp.headers },
      payload: mp.body,
    });
    expect(up.statusCode).toBe(201);
    const versionId = up.json().version_id as string;
    expect(up.json().title).toContain("Mise en page");

    // Listé.
    const list = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/step-attachments`, headers: { cookie: secCookie } });
    const rows = list.json() as { title: string; version_id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toContain("fiche-technique.txt");

    // Téléchargeable au besoin.
    const dl = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/step-attachments/${versionId}/download`, headers: { cookie: secCookie } });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toContain("Contenu de la fiche technique.");
  });

  it("pièce d'étape : un rôle sans manuscripts:saisie ne peut pas déposer (403)", async () => {
    const m = await newManuscript();
    const mp = multipart("file", "x.txt", "y");
    const up = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/step-attachments`, headers: { cookie: readerCookie, ...mp.headers }, payload: mp.body });
    expect(up.statusCode).toBe(403);
  });
});
