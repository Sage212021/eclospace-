import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Suppression LOGIQUE d'un manuscrit (contrainte d'intégrité §13) : réservée au
// niveau administration éditoriale ; le dossier reste en base (deletedAt).

const PWD = "Adm123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

async function newManuscript() {
  const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "RECEPTION" } });
  const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  return prisma.manuscript.create({
    data: { manuscriptNumber: `MS-DEL-${rnd()}`, title: `À supprimer ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
  });
}

describe("Suppression logique d'un manuscrit", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let corrCookie: string;

  beforeAll(async () => {
    app = await buildApp();
    // DIR_GENERAL détient manuscripts:administration ; CORRECTEUR non.
    const adm = `dg_${rnd()}`;
    await createUserWithRole(adm, "DIR_GENERAL", PWD);
    adminCookie = await login(app, adm);
    const corr = `corr_${rnd()}`;
    await createUserWithRole(corr, "CORRECTEUR", PWD);
    corrCookie = await login(app, corr);
  });

  afterAll(async () => {
    await app.close();
  });

  it("supprime logiquement (administration) : le dossier reste en base avec deletedAt", async () => {
    const m = await newManuscript();
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/delete`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);
    const row = await prisma.manuscript.findUnique({ where: { id: m.id } });
    expect(row).not.toBeNull(); // toujours en base
    expect(row!.deletedAt).not.toBeNull(); // marqué supprimé
  });

  it("404 si déjà supprimé", async () => {
    const m = await newManuscript();
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/delete`, headers: { cookie: adminCookie } });
    const again = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/delete`, headers: { cookie: adminCookie } });
    expect(again.statusCode).toBe(404);
  });

  it("refuse un rôle sans droit d'administration (correcteur → 403)", async () => {
    const m = await newManuscript();
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/delete`, headers: { cookie: corrCookie } });
    expect(res.statusCode).toBe(403);
  });

  it("refuse sans session (401)", async () => {
    const m = await newManuscript();
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/delete` });
    expect(res.statusCode).toBe(401);
  });
});
