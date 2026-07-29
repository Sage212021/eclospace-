import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Prise en charge & jalon devis (reconfiguration Finance) — le jalon est NON
// bloquant : établir / plus tard / passer (justifié). Liste Finance « en attente
// de devis » alimentée par les ouvrages à compte d'auteur.

const PWD = "FundTest123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("prise en charge & jalon devis (non bloquant)", () => {
  let app: FastifyInstance;
  let admin = "";
  let reader = "";
  let msId = "";

  const login = async (u: string, p = PWD) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "CORRECTION" }, select: { id: true } });
    const editor = await createUserWithRole(`fund_ed_${rnd()}`, "ADMIN_GENERAL", PWD);
    await createUserWithRole(`fund_rd_${rnd()}`, "MAGASINIER", PWD); // ni finance ni manuscripts:saisie
    const partner = await prisma.partner.create({ data: { category: "auteur", firstName: "Koffi", lastName: `Fund ${rnd()}`, penName: "Koffi FUND" } });
    const m = await prisma.manuscript.create({
      data: { title: `Ouvrage ${rnd()}`, language: "fr", manuscriptNumber: `MS-FUND-${rnd()}`, statusId: status.id, ownerId: editor.id, receivedAt: new Date() },
    });
    msId = m.id;
    await prisma.workContributor.create({ data: { manuscriptId: m.id, partnerId: partner.id, role: "author", displayOrder: 0 } });
    admin = await login("admin", "TestAdmin123!");
  });

  afterAll(async () => {
    await prisma.workContributor.deleteMany({ where: { manuscriptId: msId } });
    await prisma.manuscript.deleteMany({ where: { id: msId } });
    await app.close();
  });

  it("passe l'ouvrage à compte d'auteur, demande le devis → apparaît en attente", async () => {
    const setAuthor = await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${msId}/funding`, headers: { cookie: admin }, payload: { funding_mode: "author", decision: "requested" } });
    expect(setAuthor.statusCode).toBe(200);
    expect(setAuthor.json().funding_mode).toBe("author");

    const pending = await app.inject({ method: "GET", url: "/api/v1/finance/pending-quotes", headers: { cookie: admin } });
    expect(pending.statusCode).toBe(200);
    const rows = pending.json() as { id: string; decision: string }[];
    const row = rows.find((r) => r.id === msId);
    expect(row).toBeTruthy();
    expect(row!.decision).toBe("requested");
  });

  it("« plus tard » ne bloque pas et reste dans la liste", async () => {
    const defer = await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${msId}/funding`, headers: { cookie: admin }, payload: { decision: "deferred" } });
    expect(defer.statusCode).toBe(200);
    const pending = await app.inject({ method: "GET", url: "/api/v1/finance/pending-quotes", headers: { cookie: admin } });
    expect((pending.json() as { id: string }[]).some((r) => r.id === msId)).toBe(true);
  });

  it("« passer l'étape » exige une justification (400 sans note)", async () => {
    const noNote = await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${msId}/funding`, headers: { cookie: admin }, payload: { decision: "skipped" } });
    expect(noNote.statusCode).toBe(400);
  });

  it("« passer l'étape » (justifiée) retire l'ouvrage de la liste", async () => {
    const skip = await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${msId}/funding`, headers: { cookie: admin }, payload: { decision: "skipped", note: "Ouvrage offert, accord particulier." } });
    expect(skip.statusCode).toBe(200);
    const pending = await app.inject({ method: "GET", url: "/api/v1/finance/pending-quotes", headers: { cookie: admin } });
    expect((pending.json() as { id: string }[]).some((r) => r.id === msId)).toBe(false);
  });

  it("un rôle sans droit de saisie manuscrit ne peut pas décider (403)", async () => {
    const readerUser = await prisma.user.findFirstOrThrow({ where: { username: { startsWith: "fund_rd_" } } });
    reader = await login(readerUser.username);
    const res = await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${msId}/funding`, headers: { cookie: reader }, payload: { decision: "deferred" } });
    expect(res.statusCode).toBe(403);
  });
});
