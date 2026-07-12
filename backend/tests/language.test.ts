import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// i18n : langue d'interface mémorisée sur le profil (fr|en).

describe("langue d'interface (i18n)", () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    // On remet le compte admin en français pour ne pas influencer d'autres runs.
    await app.inject({ method: "PATCH", url: "/api/v1/me/language", headers: { cookie }, payload: { language: "fr" } });
    await app.close();
    await prisma.$disconnect();
  });

  it("/me renvoie la langue (fr par défaut)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(["fr", "en"]).toContain(res.json().language);
  });

  it("change la langue en anglais et la persiste", async () => {
    const patch = await app.inject({ method: "PATCH", url: "/api/v1/me/language", headers: { cookie }, payload: { language: "en" } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().language).toBe("en");
    const me = await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } });
    expect(me.json().language).toBe("en");
  });

  it("refuse une langue non supportée (400)", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/v1/me/language", headers: { cookie }, payload: { language: "es" } });
    expect(res.statusCode).toBe(400);
  });
});
