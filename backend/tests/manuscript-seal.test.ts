import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Scellé d'archivage définitif : un dossier arrivé à l'Archivage peut être scellé
// → lecture seule totale (aucune écriture/retrait de document). Seul un
// administrateur peut le rouvrir (motif obligatoire). Un dossier non archivé
// n'est jamais scellable.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

function multipart(field: string, filename: string, content: string) {
  const boundary = "----ecl" + rnd();
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body };
}

async function loginCookie(app: FastifyInstance, u: string, p: string) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("scellé d'archivage définitif du dossier manuscrit", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let correcteurCookie: string;
  const created: string[] = [];

  async function manuscriptAt(code: string) {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code } });
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    return prisma.manuscript.create({
      data: { manuscriptNumber: `MS-SEAL-${rnd()}`, title: `Seal ${rnd()}`, statusId: status.id, ownerId: admin.id, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
  }

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const corr = `corrseal_${rnd()}`;
    await createUserWithRole(corr, "CORRECTEUR", "Corr123!");
    created.push(corr);
    correcteurCookie = await loginCookie(app, corr, "Corr123!");
  });

  afterAll(async () => {
    for (const u of created) { try { await prisma.user.updateMany({ where: { username: u }, data: { status: "disabled" } }); } catch { /* non bloquant */ } }
    await app.close();
    await prisma.$disconnect();
  });

  it("scelle un dossier arrivé à l'Archivage", async () => {
    const m = await manuscriptAt("ARCHIVAGE");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/seal`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().sealed).toBe(true);
    const got = (await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}`, headers: { cookie: adminCookie } })).json();
    expect(got.sealed).toBe(true);
  });

  it("refuse de sceller un dossier non archivé (409 not_archived)", async () => {
    const m = await manuscriptAt("PLANIFICATION");
    const res = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/seal`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("not_archived");
  });

  it("un dossier scellé refuse toute écriture de document (409) mais reste consultable", async () => {
    const m = await manuscriptAt("ARCHIVAGE");
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/seal`, headers: { cookie: adminCookie } });

    // Écriture (dépôt VC1) refusée.
    const up = multipart("file", "x.txt", "y");
    const write = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/vc1/manuscrit`, headers: { cookie: adminCookie, ...up.headers }, payload: up.body });
    expect(write.statusCode).toBe(409);
    expect(write.json().code).toBe("manuscript_sealed");

    // Consultation (GET) toujours possible.
    const read = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/vc1`, headers: { cookie: adminCookie } });
    expect(read.statusCode).toBe(200);
  });

  it("réouverture : motif obligatoire, réservée à l'admin, puis écriture de nouveau possible", async () => {
    const m = await manuscriptAt("ARCHIVAGE");
    await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/seal`, headers: { cookie: adminCookie } });

    // Motif obligatoire.
    const noReason = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/unseal`, headers: { cookie: adminCookie }, payload: {} });
    expect(noReason.statusCode).toBe(400);

    // Réservée à l'administration (un correcteur ne peut pas).
    const byCorr = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/unseal`, headers: { cookie: correcteurCookie }, payload: { reason: "essai" } });
    expect(byCorr.statusCode).toBe(403);

    // L'admin rouvre avec motif.
    const ok = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/unseal`, headers: { cookie: adminCookie }, payload: { reason: "Correction d'une pièce manquante." } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().sealed).toBe(false);

    // L'écriture redevient possible.
    const up = multipart("file", "ok.txt", "contenu");
    const write = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${m.id}/vc1/manuscrit`, headers: { cookie: adminCookie, ...up.headers }, payload: up.body });
    expect(write.statusCode).toBe(201);
  });
});
