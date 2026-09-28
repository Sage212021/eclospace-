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

  it("la couverture de l'infographe (ImageAsset couverture_1 image) alimente automatiquement le catalogue", async () => {
    const publishedStatus = await prisma.workflowStatus.findFirstOrThrow({ where: { stepOrder: { gte: 17 } }, orderBy: { stepOrder: "asc" } });
    const m = await prisma.manuscript.create({ data: { manuscriptNumber: `COV-${s}`, title: `Ouvrage avec couverture infographe ${s}`, language: "fr", statusId: publishedStatus.id, ownerId: adminId, receivedAt: new Date(), publicationDate: new Date("2026-02-01") } });
    // Aucune pièce « couverture » dédiée : seule la couverture (1ʳᵉ) de l'infographe existe.
    const doc = await prisma.document.create({ data: { entityType: "manuscript", entityId: m.id, category: "piece_etape", confidentiality: "interne", title: "[livrable:INFOGRAPHIE] couverture.png", createdBy: adminId, updatedBy: adminId } });
    const ver = await prisma.documentVersion.create({ data: { documentId: doc.id, versionNumber: 1, filePath: `test/cover-${s}.png`, fileSize: 100, mimeType: "image/png", sha256Hash: "0".repeat(64), uploadedBy: adminId } });
    await prisma.imageAsset.create({ data: { manuscriptId: m.id, type: "couverture_1", technicalOk: true, rightsOrigin: "creation_interne", documentVersionId: ver.id } });

    const res = await app.inject({ method: "GET", url: `/api/v1/catalogue?q=COV-${s}`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as { reference: string; hasCover: boolean }[];
    const row = items.find((i) => i.reference === `COV-${s}`);
    expect(row?.hasCover).toBe(true);
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
