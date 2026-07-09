import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(response.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("recherche globale (barre supérieure)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let genreId: string;
  // Suffixe aléatoire : la base n'est pas réinitialisée entre les exécutions,
  // un libellé statique risquerait de croiser d'autres jeux de test.
  const tag = Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const genre = await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } });
    genreId = genre.id;

    // Ouvrage repère : titre + auteur reconnaissables par leur suffixe unique.
    await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: {
        title: `Le Chercheur ${tag}`,
        genre_id: genreId,
        language: "fr",
        owner_id: adminId,
        author: { first_name: "Zadie", last_name: `Molonga${tag}` },
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("retrouve un ouvrage par un fragment de son titre", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/quick-search?q=${encodeURIComponent(`Chercheur ${tag}`)}`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const { results } = res.json();
    expect(results.some((r: { title: string }) => r.title === `Le Chercheur ${tag}`)).toBe(true);
  });

  it("retrouve un ouvrage par le nom de son auteur", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/quick-search?q=${encodeURIComponent(`Molonga${tag}`)}`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const { results } = res.json();
    const found = results.find((r: { title: string }) => r.title === `Le Chercheur ${tag}`);
    expect(found).toBeDefined();
    expect(found.author).toContain(`Molonga${tag}`);
  });

  it("renvoie une liste vide pour une requête vide (jamais d'erreur)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/quick-search?q=", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toEqual([]);
  });

  it("exige une session (401 sans authentification)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/quick-search?q=${tag}` });
    expect(res.statusCode).toBe(401);
  });

  it("ne renvoie rien à un profil sans permission de consultation des ouvrages", async () => {
    // Un correcteur n'a pas « manuscripts:consultation » : la recherche reste
    // accessible mais confidentielle (liste vide), jamais une erreur bloquante.
    await createUserWithRole("correcteur_search_test", "CORRECTEUR", "Correcteur123!");
    const cookie = await loginCookie(app, "correcteur_search_test", "Correcteur123!");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/quick-search?q=${encodeURIComponent(`Chercheur ${tag}`)}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toEqual([]);
  });
});
