import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import type { FastifyInstance } from "fastify";

// Renforts de sécurité (audit — points 1 à 3) :
//  - en-têtes de sécurité du navigateur (helmet) ;
//  - filet d'erreur global (jamais de détail technique renvoyé) ;
//  - limitation des tentatives de connexion (anti-force brute).
// Chaque bloc construit sa propre application pour isoler le compteur de
// tentatives (en mémoire, par instance).

describe("en-têtes de sécurité (helmet)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("expose les en-têtes de protection standard", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    // Anti-reniflage de type et anti-affichage dans une iframe étrangère.
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
  });
});

describe("filet d'erreur global", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("répond en JSON propre (jamais une page de crash) à une requête mal formée", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{ ceci n'est pas du json",
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    // La réponse reste structurée et sans stack technique.
    const body = res.json();
    expect(body).toHaveProperty("message");
    expect(JSON.stringify(body).toLowerCase()).not.toContain("prisma");
  });
});

describe("limitation des tentatives de connexion (anti-force brute)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("bloque en 429 au-delà de 10 tentatives par minute", async () => {
    const attempt = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { username: "inconnu-force-brute", password: "x" },
      });

    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await attempt();
      statuses.push(res.statusCode);
    }
    // Les premières tentatives sont refusées normalement (401), pas bloquées.
    expect(statuses[0]).toBe(401);
    // Au-delà du seuil, la limitation renvoie 429 avec un message clair.
    expect(statuses).toContain(429);
    const last = await attempt();
    expect(last.statusCode).toBe(429);
    expect(last.json().code).toBe("too_many_attempts");
  });
});
