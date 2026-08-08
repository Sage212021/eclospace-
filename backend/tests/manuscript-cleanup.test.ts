import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Outils de nettoyage : fiches catalogue à compléter + épuration des essais
// (avec garde-fous catalogue / financier).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("nettoyage des ouvrages (fiches à compléter / épuration des essais)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let genreId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function newEssai(title: string) {
    const r = await app.inject({
      method: "POST", url: "/api/v1/manuscripts", headers: { cookie },
      payload: { title, genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "Essai", last_name: title } },
    });
    return r.json().id as string;
  }

  it("un essai sans empreinte est candidat SÛR et s'archive (réversible)", async () => {
    const id = await newEssai(`Essai ${Date.now()}`);
    const cand = (await app.inject({ method: "GET", url: "/api/v1/manuscripts/purge-candidates", headers: { cookie } })).json();
    const row = cand.find((c: { id: string }) => c.id === id);
    expect(row.safe).toBe(true);

    const purge = await app.inject({ method: "POST", url: "/api/v1/manuscripts/purge", headers: { cookie }, payload: { ids: [id] } });
    expect(purge.statusCode).toBe(200);
    expect(purge.json().archived_count).toBe(1);
    const row2 = await prisma.manuscript.findUnique({ where: { id } });
    expect(row2?.deletedAt).not.toBeNull();
    expect((await app.inject({ method: "GET", url: `/api/v1/manuscripts/${id}`, headers: { cookie } })).statusCode).toBe(404);
  });

  it("un manuscrit avec contrat est PROTÉGÉ (non sûr) et la purge le saute", async () => {
    const id = await newEssai(`Sous contrat ${Date.now()}`);
    const partner = await prisma.partner.create({ data: { category: "auteur", firstName: "P", lastName: "Rot" } });
    await prisma.contract.create({ data: { contractNumber: `CT-CLN-${Date.now()}`, manuscriptId: id, partnerId: partner.id, type: "edition", status: "preparation", financialTerms: {}, createdBy: adminId } });

    const cand = (await app.inject({ method: "GET", url: "/api/v1/manuscripts/purge-candidates", headers: { cookie } })).json();
    const row = cand.find((c: { id: string }) => c.id === id);
    expect(row.safe).toBe(false);
    expect(row.blockers).toContain("contrat");

    // Même forcé dans la liste, le serveur refuse d'archiver un ouvrage protégé.
    const purge = await app.inject({ method: "POST", url: "/api/v1/manuscripts/purge", headers: { cookie }, payload: { ids: [id] } });
    expect(purge.json().archived_count).toBe(0);
    expect(purge.json().skipped.length).toBe(1);
    expect((await app.inject({ method: "GET", url: `/api/v1/manuscripts/${id}`, headers: { cookie } })).statusCode).toBe(200);
  });

  it("un ouvrage importé (déjà paru) sans ISBN ressort dans les fiches à compléter", async () => {
    const imp = await app.inject({
      method: "POST", url: "/api/v1/manuscripts/import", headers: { cookie },
      payload: { title: `Import ${Date.now()}`, genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "Cat", last_name: "Alogue" }, publication_date: "2020-01-01T00:00:00.000Z" },
    });
    expect(imp.statusCode).toBe(201);
    const id = imp.json().id as string;

    const inc = (await app.inject({ method: "GET", url: "/api/v1/manuscripts/catalogue-incomplete", headers: { cookie } })).json();
    const row = inc.find((m: { id: string }) => m.id === id);
    expect(row).toBeTruthy();
    expect(row.missing).toContain("ISBN");
  });
});
