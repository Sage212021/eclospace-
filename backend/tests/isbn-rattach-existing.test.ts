import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

// Rattacher un ISBN EXISTANT (déjà paru) au dossier en cours : même ouvrage,
// on relie le numéro au manuscrit que l'on fait passer par les étapes.
describe("Rattacher un ISBN existant au manuscrit en cours", () => {
  let app: FastifyInstance;
  let cookie: string;
  let mCatalogue = "";
  let mCurrent = "";
  let isbnId = "";
  const s = Math.random().toString(36).slice(2, 7);
  const isbn13 = `97899560${String(Date.now()).slice(-4)}`.slice(0, 12).padEnd(12, "0") + "0";

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const status = await prisma.workflowStatus.findFirstOrThrow();
    const mk = async (suffix: string) => (await prisma.manuscript.create({ data: { manuscriptNumber: `MS-RAT-${suffix}-${s}`, title: `Rattach ${suffix} ${s}`, language: "fr", statusId: status.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } })).id;
    mCatalogue = await mk("cat");
    mCurrent = await mk("cur");
    // ISBN déjà paru, rattaché à la fiche catalogue.
    const isbn = await prisma.isbn.create({ data: { isbn13, format: "print", status: "assigned", manuscriptId: mCatalogue, assignedBy: adminId, assignedAt: new Date(), title: `Rattach cat ${s}` } });
    isbnId = isbn.id;
  });

  afterAll(async () => {
    await prisma.isbn.deleteMany({ where: { id: isbnId } }).catch(() => {});
    await prisma.manuscript.deleteMany({ where: { id: { in: [mCatalogue, mCurrent] } } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("rattache l'ISBN existant au dossier en cours (transfert tracé)", async () => {
    const r = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${mCurrent}/isbn/${isbnId}/rattach`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { outcome: string }).outcome).toBe("transferred");
    const row = await prisma.isbn.findUniqueOrThrow({ where: { id: isbnId } });
    expect(row.manuscriptId).toBe(mCurrent);
    // Le titre/numéro sont conservés (même ouvrage).
    expect(row.isbn13).toBe(isbn13);
    // Trace au journal.
    const audit = await prisma.auditLog.count({ where: { entityType: "isbn", entityId: isbnId, action: "update" } });
    expect(audit).toBeGreaterThanOrEqual(1);
  });

  it("rattacher à nouveau le même ouvrage → déjà rattaché (no-op)", async () => {
    const r = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${mCurrent}/isbn/${isbnId}/rattach`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { outcome: string }).outcome).toBe("already_attached");
  });

  it("refuse un ISBN annulé", async () => {
    await prisma.isbn.update({ where: { id: isbnId }, data: { status: "cancelled" } });
    const r = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${mCatalogue}/isbn/${isbnId}/rattach`, headers: { cookie } });
    expect(r.statusCode).toBe(409);
  });
});
