import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Abonnements « Web Push » : gestion nominative des appareils d'un utilisateur.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const login = async (app: FastifyInstance, u: string, p: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

describe("notifications push — abonnements par appareil", () => {
  let app: FastifyInstance;
  let cookie: string;
  const endpoint = `https://push.example.com/ep/${Math.random().toString(36).slice(2)}`;

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login(app, "admin", ADMIN_PASSWORD);
  });

  afterAll(async () => {
    await prisma.pushSubscription.deleteMany({ where: { endpoint } });
    await app.close();
    await prisma.$disconnect();
  });

  it("expose l'état du service (clé publique VAPID)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/push/public-key", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    // En test, aucune clé VAPID n'est configurée : le service est simplement inactif.
    expect(res.json()).toHaveProperty("configured");
  });

  it("refuse un abonnement mal formé (400)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/push/subscribe", headers: { cookie }, payload: { endpoint: "pas-une-url" } });
    expect(res.statusCode).toBe(400);
  });

  it("enregistre puis met à jour un abonnement (idempotent par endpoint)", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/push/subscribe",
      headers: { cookie },
      payload: { endpoint, keys: { p256dh: "cle-p256dh-1", auth: "cle-auth-1" } },
    });
    expect(first.statusCode).toBe(201);

    const again = await app.inject({
      method: "POST",
      url: "/api/v1/push/subscribe",
      headers: { cookie },
      payload: { endpoint, keys: { p256dh: "cle-p256dh-2", auth: "cle-auth-2" } },
    });
    expect(again.statusCode).toBe(201);

    const rows = await prisma.pushSubscription.findMany({ where: { endpoint } });
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe("cle-p256dh-2"); // mis à jour, pas dupliqué
  });

  it("désabonne l'appareil", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/push/unsubscribe", headers: { cookie }, payload: { endpoint } });
    expect(res.statusCode).toBe(200);
    const rows = await prisma.pushSubscription.findMany({ where: { endpoint } });
    expect(rows).toHaveLength(0);
  });

  it("exige une authentification", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/push/public-key" });
    expect(res.statusCode).toBe(401);
  });
});
