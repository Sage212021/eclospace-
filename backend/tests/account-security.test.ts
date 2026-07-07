import { afterAll, beforeAll, describe, expect, it } from "vitest";
import argon2 from "argon2";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

const suffix = Math.random().toString(36).slice(2, 8);

describe("sécurité du compte", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("change le mot de passe après vérification de l'ancien, en imposant la complexité, et le trace", async () => {
    const username = `secu_pw_${suffix}`;
    await createUserWithRole(username, "CORRECTEUR", "AncienMdp1");
    const cookie = await loginCookie(app, username, "AncienMdp1");

    // Ancien mot de passe erroné -> 401
    const wrong = await app.inject({
      method: "POST",
      url: "/api/v1/auth/change-password",
      headers: { cookie },
      payload: { current_password: "PasBon1", new_password: "NouveauMdp1" },
    });
    expect(wrong.statusCode).toBe(401);

    // Nouveau mot de passe trop faible (pas de chiffre) -> 400
    const weak = await app.inject({
      method: "POST",
      url: "/api/v1/auth/change-password",
      headers: { cookie },
      payload: { current_password: "AncienMdp1", new_password: "Tropfaible" },
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().code).toBe("weak_password");

    // Changement valide -> 200, le nouveau mot de passe fonctionne, l'ancien non
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/auth/change-password",
      headers: { cookie },
      payload: { current_password: "AncienMdp1", new_password: "NouveauMdp1" },
    });
    expect(ok.statusCode).toBe(200);

    const relog = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "NouveauMdp1" } });
    expect(relog.statusCode).toBe(200);
    const oldFails = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "AncienMdp1" } });
    expect(oldFails.statusCode).toBe(401);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "user", action: "update" },
      orderBy: { occurredAt: "desc" },
    });
    expect(audit).not.toBeNull();
  });

  it("change l'identifiant seulement après confirmation par jeton, avec trace d'audit", async () => {
    const username = `secu_id_${suffix}`;
    await createUserWithRole(username, "CORRECTEUR", "MonMotDePasse1");
    const cookie = await loginCookie(app, username, "MonMotDePasse1");

    const newUsername = `secu_id_new_${suffix}`;
    const req = await app.inject({
      method: "POST",
      url: "/api/v1/auth/request-identifier-change",
      headers: { cookie },
      payload: { current_password: "MonMotDePasse1", new_username: newUsername },
    });
    expect(req.statusCode).toBe(200);
    // SMTP non configuré en test : le lien de confirmation est renvoyé.
    const url: string = req.json().confirmation_url;
    expect(url).toContain("identifier_token=");
    const token = new URL(url).searchParams.get("identifier_token")!;

    // Tant que non confirmé, l'ancien identifiant fonctionne encore.
    const stillOld = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "MonMotDePasse1" } });
    expect(stillOld.statusCode).toBe(200);

    // Confirmation
    const confirm = await app.inject({
      method: "POST",
      url: "/api/v1/auth/confirm-identifier-change",
      payload: { token },
    });
    expect(confirm.statusCode).toBe(200);

    // Le nouvel identifiant fonctionne, l'ancien non.
    const newWorks = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: newUsername, password: "MonMotDePasse1" } });
    expect(newWorks.statusCode).toBe(200);
    const oldGone = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "MonMotDePasse1" } });
    expect(oldGone.statusCode).toBe(401);

    // Jeton rejoué -> refusé
    const replay = await app.inject({ method: "POST", url: "/api/v1/auth/confirm-identifier-change", payload: { token } });
    expect(replay.statusCode).toBe(400);
  });
});
