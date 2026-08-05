import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Entrée du relecteur : il télécharge le manuscrit confié DEPUIS SA MISSION,
// sans détenir le droit large « documents ». Contrôle d'accès : seul le
// relecteur affecté y a droit.

const PWD = "Lec123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

describe("accès du relecteur au manuscrit confié (entrée de la mission)", () => {
  let app: FastifyInstance;
  let readerCookie: string;
  let otherCookie: string;
  let assignmentId: string;

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
      data: {
        manuscriptNumber: `MS-LEC-${rnd()}`,
        title: `Manuscrit à lire ${rnd()}`,
        statusId: status.id,
        ownerId: admin.id,
        origin: "soumission",
        language: "fr",
        receivedAt: new Date(),
      },
    });
    const assignment = await prisma.readingAssignment.create({
      data: { manuscriptId: m.id, readerId: readerUser.id, dueAt: new Date(Date.now() + 7 * 864e5) },
    });
    assignmentId = assignment.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("404 explicite tant qu'aucun fichier manuscrit n'est déposé (relecteur affecté)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/reading-assignments/${assignmentId}/manuscript-file`, headers: { cookie: readerCookie } });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("no_manuscript_file");
  });

  it("refuse un autre relecteur que celui affecté (403)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/reading-assignments/${assignmentId}/manuscript-file`, headers: { cookie: otherCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("refuse sans session (401)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/reading-assignments/${assignmentId}/manuscript-file` });
    expect(res.statusCode).toBe(401);
  });
});
