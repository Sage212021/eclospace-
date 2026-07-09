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

describe("indicateurs de synthèse du tableau de bord", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("renvoie les grands indicateurs à l'administrateur (accès complet)", async () => {
    const cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const res = await app.inject({ method: "GET", url: "/api/v1/dashboard/stats", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Cohérence avec la base : le nombre d'ouvrages doit correspondre au count.
    const expectedOuvrages = await prisma.manuscript.count({ where: { deletedAt: null } });
    expect(body.ouvrages).toBe(expectedOuvrages);
    // Les quatre indicateurs sont des nombres pour l'admin (accès complet).
    expect(typeof body.utilisateurs).toBe("number");
    expect(typeof body.ventes).toBe("number");
    expect(typeof body.stock).toBe("number");
    expect(body.utilisateurs).toBeGreaterThanOrEqual(1);
  });

  it("masque les indicateurs hors périmètre d'un profil restreint (null)", async () => {
    // Un correcteur : pas d'accès users / commercial / stock. Il peut consulter
    // les manuscrits (permission de base d'un profil éditorial ? non — CORRECTEUR
    // n'a que documents/notifications). On vérifie donc que les indicateurs non
    // autorisés sont bien à null.
    await createUserWithRole("correcteur_kpi_test", "CORRECTEUR", "Correcteur123!");
    const cookie = await loginCookie(app, "correcteur_kpi_test", "Correcteur123!");
    const res = await app.inject({ method: "GET", url: "/api/v1/dashboard/stats", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.utilisateurs).toBeNull();
    expect(body.ventes).toBeNull();
    expect(body.stock).toBeNull();
  });

  it("exige une session (401 sans authentification)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/dashboard/stats" });
    expect(res.statusCode).toBe(401);
  });
});
