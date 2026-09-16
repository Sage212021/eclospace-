import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Ajout rapide d'un ouvrage/bien au catalogue CENTRAL depuis la remise (D-042,
// option A). Une seule voie de vérité : la fiche créée doit apparaître dans le
// référentiel /isbns (pas un catalogue parallèle) et être immédiatement
// remissible. Contrôle de doublon par titre et par ISBN.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("Ajout rapide d'un bien commercial au catalogue central (D-042)", () => {
  let app: FastifyInstance;
  let cookie: string;
  const s = Math.random().toString(36).slice(2, 7);
  const title = `Bien commercial ${s}`;
  const isbn13 = `978${Math.floor(1e9 + Math.random() * 8e9)}`; // 13 chiffres

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };
  const quick = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/v1/commercial-stock/quick-good", headers: { cookie }, payload });

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login("admin", ADMIN_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("crée une fiche minimale (titre + ISBN + auteur + prix) visible dans le catalogue central", async () => {
    const res = await quick({ title, isbn13, author_name: "Jean Dupont", price: 5000 });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.isbn13).toBe(isbn13);
    expect(body.manuscript.title).toBe(title);
    expect(body.author).toBe("Jean Dupont");
    expect(body.price_ht).toBe(5000);

    // Source unique : présent dans /isbns (référentiel des sélecteurs d'ouvrage).
    const refs = (await app.inject({ method: "GET", url: "/api/v1/isbns", headers: { cookie } })).json();
    const found = (refs as Array<{ id: string; isbn13: string }>).find((i) => i.id === body.id);
    expect(found).toBeTruthy();
    expect(found!.isbn13).toBe(isbn13);
  });

  it("refuse un doublon de TITRE et renvoie la fiche existante à sélectionner (409)", async () => {
    const res = await quick({ title, isbn13: `978${Math.floor(1e9 + Math.random() * 8e9)}` });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe("duplicate_manuscript");
    expect(body.existing).toBeTruthy();
    expect(body.existing.isbn13).toBe(isbn13); // la fiche déjà créée plus haut
  });

  it("refuse un doublon d'ISBN et renvoie la fiche existante (409)", async () => {
    const res = await quick({ title: `Autre titre ${s}`, isbn13 });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe("isbn_exists");
    expect(body.existing.isbn13).toBe(isbn13);
  });

  it("sans ISBN, pose une référence provisoire interne (PROV-…) unique", async () => {
    const res = await quick({ title: `Sans ISBN ${s}` });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.isbn13).toMatch(/^PROV-MS-/);
  });

  it("rejette un ISBN mal formé (≠ 13 chiffres) sans rien créer", async () => {
    const res = await quick({ title: `ISBN invalide ${s}`, isbn13: "123" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("isbn_invalid");
  });

  it("exige une session (401)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/commercial-stock/quick-good", payload: { title: "X" } });
    expect(res.statusCode).toBe(401);
  });
});
