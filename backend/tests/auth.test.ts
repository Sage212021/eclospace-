import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authenticator } from "otplib";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("authentification et permissions (Lot 0)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("refuse un mot de passe invalide", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "admin", password: "mauvais-mot-de-passe" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("invalid_credentials");
  });

  it("connecte l'administrateur et expose ses permissions effectives via /me", async () => {
    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "admin", password: ADMIN_PASSWORD },
    });
    expect(loginResponse.statusCode).toBe(200);
    expect(loginResponse.json().requires_2fa).toBe(false);

    const cookie = extractSessionCookie(loginResponse.cookies.map((c) => `${c.name}=${c.value}`));
    const meResponse = await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } });
    expect(meResponse.statusCode).toBe(200);
    const me = meResponse.json();
    expect(me.roles).toContain("ADMIN_GENERAL");
    expect(me.permissions).toContain("documents:administration");
  });

  it("refuse /me sans session", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/me" });
    expect(response.statusCode).toBe(401);
  });

  it("applique la matrice des rôles côté serveur : un correcteur ne peut pas créer de document", async () => {
    await createUserWithRole("correcteur_auth_test", "CORRECTEUR", "Correcteur123!");

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "correcteur_auth_test", password: "Correcteur123!" },
    });
    const cookie = extractSessionCookie(loginResponse.cookies.map((c) => `${c.name}=${c.value}`));

    const forbidden = await app.inject({
      method: "POST",
      url: "/api/v1/documents",
      headers: { cookie },
      payload: {
        entity_type: "manuscript",
        entity_id: "11111111-1111-1111-1111-111111111111",
        category: "manuscrit",
        title: "Test",
        confidentiality: "interne",
      },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await app.inject({ method: "GET", url: "/api/v1/notifications", headers: { cookie } });
    expect(allowed.statusCode).toBe(200);
  });

  it("exige le code 2FA à la connexion une fois activé, et refuse un code invalide", async () => {
    const user = await createUserWithRole("mfa_test_user", "ASSISTANT_EDITORIAL", "MfaTest123!");

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "mfa_test_user", password: "MfaTest123!" },
    });
    const cookie = extractSessionCookie(loginResponse.cookies.map((c) => `${c.name}=${c.value}`));

    const enrollResponse = await app.inject({ method: "POST", url: "/api/v1/auth/mfa/enroll", headers: { cookie } });
    expect(enrollResponse.statusCode).toBe(200);
    const { secret } = enrollResponse.json();

    const validCode = authenticator.generate(secret);
    const activateResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/activate",
      headers: { cookie },
      payload: { code: validCode },
    });
    expect(activateResponse.statusCode).toBe(200);

    const secondLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "mfa_test_user", password: "MfaTest123!" },
    });
    expect(secondLogin.statusCode).toBe(200);
    expect(secondLogin.json().requires_2fa).toBe(true);
    const challengeId = secondLogin.json().challenge_id;

    const badCode = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa",
      payload: { challenge_id: challengeId, code: "000000" },
    });
    expect(badCode.statusCode).toBe(401);

    const goodCode = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa",
      payload: { challenge_id: challengeId, code: authenticator.generate(secret) },
    });
    expect(goodCode.statusCode).toBe(200);
    expect(goodCode.cookies.length).toBeGreaterThan(0);

    void user;
  });

  it("interdit toute modification ou suppression du journal d'audit (append-only)", async () => {
    const entry = await prisma.auditLog.findFirst();
    expect(entry).not.toBeNull();

    await expect(prisma.auditLog.deleteMany({ where: { id: entry!.id } })).rejects.toThrow();
    await expect(
      prisma.auditLog.updateMany({ where: { id: entry!.id }, data: { entityType: "modifie" } }),
    ).rejects.toThrow();
  });
});
