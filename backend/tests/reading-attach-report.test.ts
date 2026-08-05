import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// « Joindre à l'ouvrage » : le relecteur verse son rapport (fichier déposé)
// comme pièce officielle (rapport_lecture) de l'ouvrage. Réservé au relecteur.

const PWD = "Lec123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};
function multipart(field: string, filename: string, content: string) {
  const boundary = "----ecl" + rnd();
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body };
}

describe("Joindre le rapport de lecture à l'ouvrage", () => {
  let app: FastifyInstance;
  let readerCookie: string;
  let otherCookie: string;
  let assignmentId: string;
  let manuscriptId: string;

  beforeAll(async () => {
    app = await buildApp();
    const reader = `lec_${rnd()}`;
    const readerUser = await createUserWithRole(reader, "MEMBRE_COMITE_LECTURE", PWD);
    readerCookie = await login(app, reader);
    const other = `lec2_${rnd()}`;
    await createUserWithRole(other, "MEMBRE_COMITE_LECTURE", PWD);
    otherCookie = await login(app, other);

    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "COMITE_LECTURE" } });
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-ATT-${rnd()}`, title: `Rapport ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    manuscriptId = m.id;
    const a = await prisma.readingAssignment.create({ data: { manuscriptId: m.id, readerId: readerUser.id, dueAt: new Date(Date.now() + 7 * 864e5) } });
    assignmentId = a.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("409 tant qu'aucun fichier de rapport n'est déposé", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/reading-assignments/${assignmentId}/attach-report`, headers: { cookie: readerCookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("no_report_file");
  });

  it("après dépôt du fichier, le rapport est joint comme pièce de l'ouvrage", async () => {
    const mp = multipart("file", "rapport.pdf", "Mon rapport de lecture");
    const up = await app.inject({ method: "POST", url: `/api/v1/reading-assignments/${assignmentId}/report-file`, headers: { cookie: readerCookie, ...mp.headers }, payload: mp.body });
    expect(up.statusCode).toBe(200);

    const res = await app.inject({ method: "POST", url: `/api/v1/reading-assignments/${assignmentId}/attach-report`, headers: { cookie: readerCookie } });
    expect(res.statusCode).toBe(201);
    expect(res.json().attached).toBe(true);

    const docs = await prisma.document.findMany({ where: { entityType: "manuscript", entityId: manuscriptId, category: "rapport_lecture", deletedAt: null }, include: { versions: true } });
    expect(docs.length).toBe(1);
    expect(docs[0].versions.length).toBeGreaterThanOrEqual(1);
  });

  it("refuse un autre relecteur que celui de la mission (403)", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/reading-assignments/${assignmentId}/attach-report`, headers: { cookie: otherCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("refuse sans session (401)", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/reading-assignments/${assignmentId}/attach-report` });
    expect(res.statusCode).toBe(401);
  });
});
