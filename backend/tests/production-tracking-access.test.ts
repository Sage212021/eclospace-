import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// « Suivi des ouvrages » (GET /production-tracking) : réservé aux pôles
// éditorial et production et à la direction. Tout autre pôle (finance,
// juridique, stock…) reçoit 403 — contrôle par RÔLE, vérifié côté serveur,
// indépendamment de ce que le menu affiche.

const PASSWORD = "TrackAccess123!";

async function login(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: PASSWORD } });
  expect(res.statusCode).toBe(200);
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

async function getTracking(app: FastifyInstance, username: string): Promise<number> {
  const cookie = await login(app, username);
  const res = await app.inject({ method: "GET", url: "/api/v1/production-tracking", headers: { cookie } });
  return res.statusCode;
}

describe("accès au suivi des ouvrages", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    // Autorisés : éditorial (assistant éditorial) et production (maquettiste).
    await createUserWithRole("track_editorial", "ASSISTANT_EDITORIAL", PASSWORD);
    await createUserWithRole("track_production", "MAQUETTISTE", PASSWORD);
    // Refusés : finance (comptable), juridique, stock (magasinier).
    await createUserWithRole("track_finance", "COMPTABLE", PASSWORD);
    await createUserWithRole("track_juridique", "RESP_JURIDIQUE", PASSWORD);
    await createUserWithRole("track_stock", "MAGASINIER", PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("autorise le pôle éditorial (200)", async () => {
    expect(await getTracking(app, "track_editorial")).toBe(200);
  });

  it("autorise le pôle production (200)", async () => {
    expect(await getTracking(app, "track_production")).toBe(200);
  });

  it("refuse la finance/comptabilité (403)", async () => {
    expect(await getTracking(app, "track_finance")).toBe(403);
  });

  it("refuse le juridique (403), même s'il a manuscripts:consultation", async () => {
    expect(await getTracking(app, "track_juridique")).toBe(403);
  });

  it("refuse le stock (403)", async () => {
    expect(await getTracking(app, "track_stock")).toBe(403);
  });

  it("refuse un visiteur non connecté (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/production-tracking" });
    expect(res.statusCode).toBe(401);
  });
});
