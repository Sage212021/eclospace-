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

describe("archivage hiérarchique & gouvernance (Phases 4-5)", () => {
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

  // --- Phase 4 : archivage hiérarchique ---
  it("expose les ouvrages avec leurs axes de classement pour l'archivage", async () => {
    const tag = Math.random().toString(36).slice(2, 7);
    await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts/import",
      headers: { cookie: adminCookie },
      payload: {
        title: `Archive ${tag}`,
        genre_id: genreId,
        language: "fr",
        owner_id: adminId,
        author: { first_name: "Awa", last_name: "Traoré" },
        publication_date: "2021-07-04",
      },
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/archives", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    const mine = rows.find((r: { title: string }) => r.title === `Archive ${tag}`);
    expect(mine).toBeTruthy();
    expect(mine.publicationDate.slice(0, 10)).toBe("2021-07-04");
    expect(mine.genre).toBe("Roman");
    expect(mine.author).toBe("Awa Traoré");
  });

  // --- Phase 5 : gestion des comptes ---
  it("crée un compte, s'y connecte, le suspend puis interdit sa connexion", async () => {
    const suffix = Math.random().toString(36).slice(2, 7);
    const username = `agent_${suffix}`;

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { cookie: adminCookie },
      payload: { username, email: `${username}@eclospace.local`, password: "Bienvenue1", role_codes: ["CORRECTEUR"] },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json();

    // Connexion possible avec le compte fraîchement créé.
    const login1 = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "Bienvenue1" } });
    expect(login1.statusCode).toBe(200);

    // Suspension → connexion refusée.
    const suspend = await app.inject({
      method: "PATCH",
      url: `/api/v1/users/${created.id}`,
      headers: { cookie: adminCookie },
      payload: { status: "suspended" },
    });
    expect(suspend.statusCode).toBe(200);
    const login2 = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "Bienvenue1" } });
    expect(login2.statusCode).toBe(401);

    // Réactivation → connexion de nouveau possible.
    await app.inject({ method: "PATCH", url: `/api/v1/users/${created.id}`, headers: { cookie: adminCookie }, payload: { status: "active" } });
    const login3 = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "Bienvenue1" } });
    expect(login3.statusCode).toBe(200);
  });

  it("refuse un mot de passe faible à la création de compte (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { cookie: adminCookie },
      payload: { username: `faible_${Math.random().toString(36).slice(2, 7)}`, email: `x${Math.random()}@e.local`, password: "court" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("weak_password");
  });

  it("empêche l'administrateur de supprimer son propre compte", async () => {
    // Le compte admin est aussi le compte passe-partout protégé : la suppression
    // est refusée (par la protection, qui prime sur le garde-fou « soi-même »).
    const res = await app.inject({ method: "DELETE", url: `/api/v1/users/${adminId}`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(409);
    expect(["cannot_delete_self", "protected_account"]).toContain(res.json().code);
  });

  // --- Phase 5 : matrice des droits éditable ---
  it("ajuste les droits d'un rôle et applique le changement immédiatement", async () => {
    const suffix = Math.random().toString(36).slice(2, 7);
    const user = await createUserWithRole(`droit_${suffix}`, "CORRECTEUR", "Correcteur123!");
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "CORRECTEUR" } });

    // Au départ, ce profil n'a pas accès à la consultation des manuscrits.
    let cookie = await loginCookie(app, `droit_${suffix}`, "Correcteur123!");
    const before = await app.inject({ method: "GET", url: "/api/v1/manuscripts", headers: { cookie } });
    expect(before.statusCode).toBe(403);

    // L'admin accorde manuscripts:consultation au rôle.
    const grant = await app.inject({
      method: "POST",
      url: `/api/v1/roles/${role.id}/permissions`,
      headers: { cookie: adminCookie },
      payload: { module: "manuscripts", action: "consultation", granted: true },
    });
    expect(grant.statusCode).toBe(200);

    // Nouvelle session : le droit est effectif.
    cookie = await loginCookie(app, `droit_${suffix}`, "Correcteur123!");
    const after = await app.inject({ method: "GET", url: "/api/v1/manuscripts", headers: { cookie } });
    expect(after.statusCode).toBe(200);

    // Nettoyage : on retire le droit accordé pour ne pas polluer les autres tests.
    await app.inject({
      method: "POST",
      url: `/api/v1/roles/${role.id}/permissions`,
      headers: { cookie: adminCookie },
      payload: { module: "manuscripts", action: "consultation", granted: false },
    });
    expect(user.id).toBeTruthy();
  });

  it("protège les droits de l'administrateur général (409)", async () => {
    const admin = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN_GENERAL" } });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/roles/${admin.id}/permissions`,
      headers: { cookie: adminCookie },
      payload: { module: "manuscripts", action: "consultation", granted: false },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("role_protected");
  });

  // --- Phase 5 : gestion des pôles ---
  it("crée un pôle puis refuse d'en retirer un qui porte des rôles (409)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/departments",
      headers: { cookie: adminCookie },
      payload: { name: `Pôle ${Math.random().toString(36).slice(2, 7)}` },
    });
    expect(create.statusCode).toBe(201);
    const dept = create.json();
    expect(dept.code).toMatch(/^[A-Z0-9_]+$/);

    // Un pôle vide peut être retiré.
    const del = await app.inject({ method: "DELETE", url: `/api/v1/departments/${dept.id}`, headers: { cookie: adminCookie } });
    expect(del.statusCode).toBe(200);

    // Un pôle rattaché à des rôles (ex. SECR) ne peut pas l'être.
    const secr = await prisma.department.findUniqueOrThrow({ where: { code: "SECR" } });
    const refused = await app.inject({ method: "DELETE", url: `/api/v1/departments/${secr.id}`, headers: { cookie: adminCookie } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe("department_in_use");
  });

  it("refuse la gouvernance à un profil sans users:administration (403)", async () => {
    await createUserWithRole("correcteur_gov_test", "CORRECTEUR", "Correcteur123!");
    const cookie = await loginCookie(app, "correcteur_gov_test", "Correcteur123!");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { cookie },
      payload: { username: "interdit_x", email: "interdit@e.local", password: "Bienvenue1" },
    });
    expect(res.statusCode).toBe(403);
  });
});
