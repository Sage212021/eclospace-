import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

// Légendes bilingues du catalogue (fiche partageable) — demande opérateur
// 19/11/2026. Le seed installe les légendes FR/EN + libellés de fiche exacts
// (collection, genre, pages, ISBN). La route catalogue les expose dans les deux
// langues, et l'enregistrement du résumé accepte chaque langue séparément.

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("catalogue — légendes bilingues (D-068)", () => {
  let app: FastifyInstance;
  let adminCookie: string;

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const byNum = (num: string) =>
    prisma.manuscript.findUnique({
      where: { manuscriptNumber: num },
      include: { isbns: true, genre: true },
    });

  it("installe la légende bilingue de L'enfant bâtard (FR + EN + libellés)", async () => {
    const m = await byNum("LG-CAT-0045");
    expect(m).toBeTruthy();
    expect(m!.title).toBe("L'enfant bâtard");
    expect(m!.summary).toMatch(/poids des circonstances de sa naissance/);
    expect(m!.summaryEn).toMatch(/burden of the circumstances of their birth/);
    expect(m!.legendCollectionFr).toBe("Canari");
    expect(m!.legendCollectionEn).toBe("Canari");
    expect(m!.legendGenreFr).toBe("Ouvrage de sensibilisation sociale");
    expect(m!.legendGenreEn).toBe("Social Awareness Book");
    expect(m!.legendIsbn).toBe("978-9956-0-7767-0");
    expect(m!.legendAuthor).toBe("Tchebal Dafrik");
    expect(m!.genre?.code).toBe("SENSIBILISATION");
  });

  it("corrige l'ISBN provisoire de Félonica vers l'ISBN officiel + pages", async () => {
    const m = await byNum("LG-CAT-0075");
    expect(m).toBeTruthy();
    expect(m!.title).toBe("Félonica, la femme de chez nous");
    expect(m!.isbns.some((i) => i.isbn13 === "9789956078561")).toBe(true);
    expect(m!.isbns.some((i) => i.isbn13.startsWith("978200190"))).toBe(false);
    expect(m!.legendPages).toBe(164);
    expect(m!.legendIsbn).toBe("978-9956-0-7856-1");
  });

  it("installe Victimes en FR (traduction) + EN", async () => {
    const m = await byNum("LG-CAT-0051");
    expect(m).toBeTruthy();
    expect(m!.title).toBe("Victimes");
    expect(m!.summaryEn).toMatch(/today's victims became tomorrow's perpetrators/);
    expect(m!.summary).toMatch(/victimes d'aujourd'hui devenaient les bourreaux de demain/);
    expect(m!.genre?.code).toBe("NOUVELLE");
  });

  it("expose la légende bilingue dans la liste du catalogue", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalogue?q=enfant b", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const row = res.json().items.find((r: { reference: string }) => r.reference === "LG-CAT-0045");
    expect(row).toBeTruthy();
    expect(row.summary).toMatch(/circonstances de sa naissance/);
    expect(row.summaryEn).toMatch(/circumstances of their birth/);
    expect(row.collectionLabel).toBe("Canari");
    expect(row.collectionLabelEn).toBe("Canari");
    expect(row.genreLabel).toBe("Ouvrage de sensibilisation sociale");
    expect(row.genreLabelEn).toBe("Social Awareness Book");
    expect(row.isbn).toBe("978-9956-0-7767-0");
    expect(row.authorDisplay).toBe("Tchebal Dafrik");
  });

  it("enregistre le synopsis anglais sans toucher au résumé français", async () => {
    const m = await byNum("LG-CAT-0048"); // J'étais une femme riche
    const before = m!.summary;
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/catalogue/${m!.id}/summary`,
      headers: { cookie: adminCookie },
      payload: { summaryEn: "A brand new English synopsis for testing." },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summaryEn).toBe("A brand new English synopsis for testing.");
    const after = await prisma.manuscript.findUniqueOrThrow({ where: { id: m!.id }, select: { summary: true, summaryEn: true } });
    expect(after.summaryEn).toBe("A brand new English synopsis for testing.");
    expect(after.summary).toBe(before); // le français n'a pas bougé
  });

  it("refuse un enregistrement de résumé sans aucune langue (400)", async () => {
    const m = await byNum("LG-CAT-0048");
    const res = await app.inject({ method: "PATCH", url: `/api/v1/catalogue/${m!.id}/summary`, headers: { cookie: adminCookie }, payload: {} });
    expect(res.statusCode).toBe(400);
  });
});
