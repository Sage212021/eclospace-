import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

// Attribution par numéro (Lot 3 — parcours §9) : saisir un ISBN → vérifier →
// attribuer / rattacher / enregistrer-et-attribuer / bloquer.
describe("Attribution d'ISBN par numéro (Banque)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  const tag = Math.random().toString(36).slice(2, 7);
  let msA: string;
  let msB: string;
  const base = String(Date.now()).slice(-8); // 8 chiffres uniques
  const isbnDispo = `97811${base}`.slice(0, 13).padEnd(13, "0");
  const isbnLibre = `97822${base}`.slice(0, 13).padEnd(13, "0");
  const isbnAutre = `97833${base}`.slice(0, 13).padEnd(13, "0");
  const isbnAnnule = `97844${base}`.slice(0, 13).padEnd(13, "0");
  const isbnNeuf = "978-9956-77-123-9"; // absent de la banque, avec tirets

  beforeAll(async () => {
    app = await buildApp();
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "ATTRIBUTION_REFERENCES" } });
    const mk = async (suffix: string) =>
      (await prisma.manuscript.create({ data: { manuscriptNumber: `MS-BN-${tag}-${suffix}`, title: `Ouvrage ${suffix} ${tag}`, statusId: status.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() } })).id;
    msA = await mk("A");
    msB = await mk("B");
    await prisma.isbn.create({ data: { isbn13: isbnDispo, format: "print", status: "available" } });
    await prisma.isbn.create({ data: { isbn13: isbnLibre, format: "print", status: "assigned", assignedAt: new Date(), assignedBy: adminId } }); // attribué SANS ouvrage (déjà paru)
    await prisma.isbn.create({ data: { isbn13: isbnAutre, format: "print", status: "assigned", manuscriptId: msB, assignedAt: new Date(), assignedBy: adminId } }); // attribué à un AUTRE ouvrage
    await prisma.isbn.create({ data: { isbn13: isbnAnnule, format: "print", status: "cancelled" } });
  });

  afterAll(async () => {
    await prisma.isbn.deleteMany({ where: { isbn13: { in: [isbnDispo, isbnLibre, isbnAutre, isbnAnnule, isbnNeuf.replace(/[^0-9Xx]/g, "")] } } });
    await prisma.manuscript.deleteMany({ where: { id: { in: [msA, msB] } } });
    await app.close();
    await prisma.$disconnect();
  });

  const lookup = (ms: string, isbn: string) => app.inject({ method: "GET", url: `/api/v1/manuscripts/${ms}/isbn/lookup?isbn13=${encodeURIComponent(isbn)}`, headers: { cookie } });
  const byNumber = (ms: string, body: Record<string, unknown>) => app.inject({ method: "POST", url: `/api/v1/manuscripts/${ms}/isbn/by-number`, headers: { cookie }, payload: body });

  it("CAS 1 — disponible : lookup « disponible » puis attribution à l'ouvrage", async () => {
    expect((await lookup(msA, isbnDispo)).json().case).toBe("disponible");
    const r = await byNumber(msA, { isbn13: isbnDispo });
    expect(r.statusCode).toBe(200);
    expect(r.json().outcome).toBe("attributed");
    const after = await prisma.isbn.findFirstOrThrow({ where: { isbn13: isbnDispo } });
    expect(after.manuscriptId).toBe(msA);
    expect(after.status).toBe("assigned");
  });

  it("déjà paru — attribué SANS ouvrage : lookup « attribue_libre » puis RATTACHEMENT", async () => {
    expect((await lookup(msA, isbnLibre)).json().case).toBe("attribue_libre");
    const r = await byNumber(msA, { isbn13: isbnLibre });
    expect(r.statusCode).toBe(200);
    expect(r.json().outcome).toBe("attached");
    expect((await prisma.isbn.findFirstOrThrow({ where: { isbn13: isbnLibre } })).manuscriptId).toBe(msA);
  });

  it("CAS 2 — attribué à un AUTRE ouvrage : lookup « attribue_autre » et attribution bloquée", async () => {
    const lk = await lookup(msA, isbnAutre);
    expect(lk.json().case).toBe("attribue_autre");
    expect(lk.json().other_manuscript?.id).toBe(msB);
    const r = await byNumber(msA, { isbn13: isbnAutre });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("isbn_assigned_other");
    // Inchangé : toujours rattaché à l'autre ouvrage.
    expect((await prisma.isbn.findFirstOrThrow({ where: { isbn13: isbnAutre } })).manuscriptId).toBe(msB);
  });

  it("annulé : lookup « annule » et attribution refusée", async () => {
    expect((await lookup(msA, isbnAnnule)).json().case).toBe("annule");
    const r = await byNumber(msA, { isbn13: isbnAnnule });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("isbn_cancelled");
  });

  it("CAS 3 — absent : lookup « absent » puis ENREGISTRER-ET-ATTRIBUER (numéro normalisé)", async () => {
    expect((await lookup(msA, isbnNeuf)).json().case).toBe("absent");
    const r = await byNumber(msA, { isbn13: isbnNeuf, format: "print" });
    expect(r.statusCode).toBe(201);
    expect(r.json().outcome).toBe("registered_and_attributed");
    const created = await prisma.isbn.findFirstOrThrow({ where: { isbn13: isbnNeuf.replace(/[^0-9Xx]/g, "") } });
    expect(created.manuscriptId).toBe(msA);
    expect(created.status).toBe("assigned");
  });
});
