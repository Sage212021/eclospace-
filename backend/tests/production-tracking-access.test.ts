import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// « Suivi des ouvrages » (GET /production-tracking) : réservé aux pôles
// éditorial, production, finance et direction. Les autres pôles (ici le stock)
// doivent recevoir 403 — contrôle d'accès vérifié côté serveur, indépendamment
// de ce que le menu affiche.

const PASSWORD = "TrackAccess123!";

async function login(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: PASSWORD } });
  expect(res.statusCode).toBe(200);
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("accès au suivi des ouvrages", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    // Maquettiste = pôle production (production:consultation) → autorisé.
    await createUserWithRole("track_maquettiste", "MAQUETTISTE", PASSWORD);
    // Magasinier = pôle stock uniquement → aucun des droits de suivi.
    await createUserWithRole("track_magasinier", "MAGASINIER", PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("autorise un profil production (200)", async () => {
    const cookie = await login(app, "track_maquettiste");
    const res = await app.inject({ method: "GET", url: "/api/v1/production-tracking", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("refuse un profil hors périmètre — stock (403)", async () => {
    const cookie = await login(app, "track_magasinier");
    const res = await app.inject({ method: "GET", url: "/api/v1/production-tracking", headers: { cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("forbidden");
  });

  it("refuse un visiteur non connecté (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/production-tracking" });
    expect(res.statusCode).toBe(401);
  });
});
