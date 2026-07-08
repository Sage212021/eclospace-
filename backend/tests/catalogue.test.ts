import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("catalogue & classements (Phase 3)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let genreId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function importBook(title: string, publicationDate: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts/import",
      headers: { cookie: adminCookie },
      payload: {
        title,
        genre_id: genreId,
        language: "fr",
        owner_id: adminId,
        author: { first_name: "A", last_name: "B" },
        publication_date: publicationDate,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  it("filtre le catalogue par période de parution et trie par date de parution", async () => {
    const tag = Math.random().toString(36).slice(2, 7);
    await importBook(`Cat ${tag} ancien`, "2015-06-01");
    await importBook(`Cat ${tag} récent`, "2023-09-20");

    // Bornes 2020 → 2025 : seul le récent doit sortir.
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/manuscripts?q=Cat ${tag}&published_from=2020-01-01&published_to=2025-12-31&sort=publication_date&order=asc`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    const titles = rows.map((r: { title: string }) => r.title);
    expect(titles).toContain(`Cat ${tag} récent`);
    expect(titles).not.toContain(`Cat ${tag} ancien`);
  });

  it("filtre par ouvrages déjà parus et recherche par titre", async () => {
    const tag = Math.random().toString(36).slice(2, 7);
    await importBook(`Repris ${tag}`, "2010-01-01");

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/manuscripts?q=Repris ${tag}&back_catalogue=true`,
      headers: { cookie: adminCookie },
    });
    const rows = res.json();
    expect(rows.length).toBe(1);
    expect(rows[0].isBackCatalogue).toBe(true);
  });

  it("crée un domaine, l'utilise, puis refuse de le retirer tant qu'il sert (409)", async () => {
    const label = `Domaine ${Math.random().toString(36).slice(2, 7)}`;
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/genres",
      headers: { cookie: adminCookie },
      payload: { label },
    });
    expect(create.statusCode).toBe(201);
    const genre = create.json();
    expect(genre.code).toMatch(/^[A-Z0-9_]+$/);

    // Retrait possible tant qu'il n'est utilisé par aucun ouvrage.
    const delOk = await app.inject({ method: "DELETE", url: `/api/v1/genres/${genre.id}`, headers: { cookie: adminCookie } });
    expect(delOk.statusCode).toBe(200);

    // Il ne figure plus dans la liste.
    const list = await app.inject({ method: "GET", url: "/api/v1/genres", headers: { cookie: adminCookie } });
    expect(list.json().some((g: { id: string }) => g.id === genre.id)).toBe(false);

    // Un domaine utilisé ne peut pas être retiré.
    const inUse = await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } });
    const delRefused = await app.inject({ method: "DELETE", url: `/api/v1/genres/${inUse.id}`, headers: { cookie: adminCookie } });
    expect(delRefused.statusCode).toBe(409);
    expect(delRefused.json().code).toBe("reference_in_use");
  });

  it("gère les collections et refuse un code déjà pris (409)", async () => {
    const label = `Collection ${Math.random().toString(36).slice(2, 7)}`;
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/collections",
      headers: { cookie: adminCookie },
      payload: { label, code: "COLL_TEST_DUP" },
    });
    expect(create.statusCode).toBe(201);

    const dup = await app.inject({
      method: "POST",
      url: "/api/v1/collections",
      headers: { cookie: adminCookie },
      payload: { label: "Autre", code: "COLL_TEST_DUP" },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("code_taken");
  });

  it("refuse la gestion des domaines à un profil sans manuscripts:administration (403)", async () => {
    await createUserWithRole("correcteur_ref_test", "CORRECTEUR", "Correcteur123!");
    const cookie = await loginCookie(app, "correcteur_ref_test", "Correcteur123!");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/genres",
      headers: { cookie },
      payload: { label: "Interdit" },
    });
    expect(res.statusCode).toBe(403);
  });
});
