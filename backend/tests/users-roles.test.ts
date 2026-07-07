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

describe("utilisateurs & rôles (écran d'administration)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("liste le référentiel des rôles et les comptes avec leurs rôles actifs", async () => {
    const cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);

    const roles = await app.inject({ method: "GET", url: "/api/v1/roles", headers: { cookie } });
    expect(roles.statusCode).toBe(200);
    expect(roles.json().some((r: { code: string }) => r.code === "ADMIN_GENERAL")).toBe(true);

    const users = await app.inject({ method: "GET", url: "/api/v1/users-with-roles", headers: { cookie } });
    expect(users.statusCode).toBe(200);
    const admin = users.json().find((u: { username: string }) => u.username === "admin");
    expect(admin).toBeTruthy();
    expect(admin.roles.some((r: { code: string }) => r.code === "ADMIN_GENERAL")).toBe(true);
    expect(admin.roles[0]).toHaveProperty("userRoleId");
  });

  it("refuse la consultation des comptes à un profil sans habilitation users (403)", async () => {
    await createUserWithRole("correcteur_ur_test", "CORRECTEUR", "Correcteur123!");
    const cookie = await loginCookie(app, "correcteur_ur_test", "Correcteur123!");
    const res = await app.inject({ method: "GET", url: "/api/v1/users-with-roles", headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });
});
