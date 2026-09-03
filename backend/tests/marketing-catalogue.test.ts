import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { prisma } = await import("../src/lib/prisma.js");
const { extractSessionCookie } = await import("./helpers.js");

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

// Catalogue du pôle Marketing & Distribution. Règle critique : SEULS les
// ouvrages publiés (étape ≥ commercialisation, stepOrder 17) et archivés
// apparaissent ; jamais un manuscrit encore en cours.
describe("Catalogue des ouvrages (Marketing & Distribution)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  const s = Math.random().toString(36).slice(2, 6);
  let publishedTitle = "";
  let draftTitle = "";

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login("admin", ADMIN_PASSWORD);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;

    const draftStatus = await prisma.workflowStatus.findFirstOrThrow({ where: { stepOrder: { lt: 17 } }, orderBy: { stepOrder: "asc" } });
    const publishedStatus = await prisma.workflowStatus.findFirstOrThrow({ where: { stepOrder: { gte: 17 } }, orderBy: { stepOrder: "asc" } });

    publishedTitle = `Ouvrage publié ${s}`;
    draftTitle = `Manuscrit en cours ${s}`;
    await prisma.manuscript.create({ data: { manuscriptNumber: `PUB-${s}`, title: publishedTitle, language: "fr", statusId: publishedStatus.id, ownerId: adminId, receivedAt: new Date(), publicationDate: new Date("2026-01-15") } });
    await prisma.manuscript.create({ data: { manuscriptNumber: `DRA-${s}`, title: draftTitle, language: "fr", statusId: draftStatus.id, ownerId: adminId, receivedAt: new Date() } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("n'affiche que les ouvrages publiés / archivés", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalogue", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const titles = (res.json().items as { title: string }[]).map((i) => i.title);
    expect(titles).toContain(publishedTitle);
    expect(titles).not.toContain(draftTitle);
  });

  it("la recherche filtre par titre / auteur / référence", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/catalogue?q=PUB-${s}`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as { reference: string }[];
    expect(items.length).toBe(1);
    expect(items[0].reference).toBe(`PUB-${s}`);
  });

  it("le tri par défaut est configurable par l'administration et appliqué", async () => {
    const put = await app.inject({ method: "PUT", url: "/api/v1/catalogue/config", headers: { cookie: adminCookie }, payload: { default_sort: "az" } });
    expect(put.statusCode).toBe(200);
    expect(put.json().defaultSort).toBe("az");

    const res = await app.inject({ method: "GET", url: "/api/v1/catalogue", headers: { cookie: adminCookie } });
    expect(res.json().sort).toBe("az");
    expect(res.json().defaultSort).toBe("az");
  });
});
