import { afterAll, beforeAll, describe, expect, it } from "vitest";
import argon2 from "argon2";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}
function cookieFrom(res: { cookies: { name: string; value: string }[] }) {
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("super-admin passe-partout, usurpation, mot de passe maître, droits par pôle", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
  });

  afterAll(async () => {
    delete process.env.MASTER_PASSWORD_HASH;
    await app.close();
    await prisma.$disconnect();
  });

  // --- Compte passe-partout inbloquable ---
  it("refuse de suspendre ou supprimer le compte passe-partout", async () => {
    const suspend = await app.inject({ method: "PATCH", url: `/api/v1/users/${adminId}`, headers: { cookie: adminCookie }, payload: { status: "suspended" } });
    expect(suspend.statusCode).toBe(409);
    expect(suspend.json().code).toBe("protected_account");

    const del = await app.inject({ method: "DELETE", url: `/api/v1/users/${adminId}`, headers: { cookie: adminCookie } });
    expect(del.statusCode).toBe(409);
    expect(del.json().code).toBe("protected_account");
  });

  // --- Mot de passe maître (bris de glace) ---
  it("permet la connexion au compte passe-partout via le mot de passe maître, en contournant tout mais en journalisant", async () => {
    process.env.MASTER_PASSWORD_HASH = await argon2.hash("SecoursMaitre2026!");

    // Un mauvais mot de passe normal échoue toujours.
    const bad = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: "totalement-faux" } });
    expect(bad.statusCode).toBe(401);

    // Le mot de passe maître ouvre le compte passe-partout.
    const master = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: "SecoursMaitre2026!" } });
    expect(master.statusCode).toBe(200);
    expect(master.json().master_access).toBe(true);

    // Tracé au journal en priorité haute.
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "user", entityId: adminId, action: "login" },
      orderBy: { occurredAt: "desc" },
    });
    expect((audit?.newValues as Record<string, unknown>)?.via).toBe("master_password");
    delete process.env.MASTER_PASSWORD_HASH;
  });

  it("n'ouvre pas un compte ordinaire avec le mot de passe maître", async () => {
    process.env.MASTER_PASSWORD_HASH = await argon2.hash("SecoursMaitre2026!");
    await createUserWithRole("ordinaire_master_test", "CORRECTEUR", "Correcteur123!");
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "ordinaire_master_test", password: "SecoursMaitre2026!" } });
    expect(res.statusCode).toBe(401);
    delete process.env.MASTER_PASSWORD_HASH;
  });

  // --- Usurpation d'identité ---
  it("permet à l'admin d'agir en tant qu'un utilisateur puis de revenir", async () => {
    const target = await createUserWithRole(`usurp_${Math.random().toString(36).slice(2, 6)}`, "CORRECTEUR", "Correcteur123!");

    const imp = await app.inject({ method: "POST", url: `/api/v1/users/${target.id}/impersonate`, headers: { cookie: adminCookie } });
    expect(imp.statusCode).toBe(200);
    const impCookie = cookieFrom(imp);

    // /me reflète l'usurpation : compte cible + administrateur réel.
    const me = await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: impCookie } });
    expect(me.json().username).toBe(target.username);
    expect(me.json().impersonating).toBe(true);
    expect(me.json().impersonator.username).toBe("admin");

    // Retour au compte administrateur.
    const stop = await app.inject({ method: "POST", url: "/api/v1/auth/stop-impersonation", headers: { cookie: impCookie } });
    expect(stop.statusCode).toBe(200);
    const backCookie = cookieFrom(stop);
    const backMe = await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: backCookie } });
    expect(backMe.json().username).toBe("admin");
    expect(backMe.json().impersonating).toBe(false);
  });

  it("interdit d'usurper le compte passe-partout", async () => {
    // Depuis un AUTRE administrateur (sinon le garde-fou « soi-même » s'applique).
    await createUserWithRole("admin_bis_test", "ADMIN_GENERAL", "AdminBis123!");
    const bisCookie = await loginCookie(app, "admin_bis_test", "AdminBis123!");
    const res = await app.inject({ method: "POST", url: `/api/v1/users/${adminId}/impersonate`, headers: { cookie: bisCookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("protected_account");
  });

  // --- Droits par pôle (réglage groupé) ---
  it("applique un droit à tous les rôles d'un pôle en une opération", async () => {
    // On rattache deux rôles de test au même pôle.
    const dept = await prisma.department.create({ data: { code: `POLE_TEST_${Math.random().toString(36).slice(2, 6)}`, name: "Pôle Test" } });
    const roleA = await prisma.role.create({ data: { code: `RA_${Math.random().toString(36).slice(2, 6)}`, label: "Rôle A", departmentId: dept.id } });
    const roleB = await prisma.role.create({ data: { code: `RB_${Math.random().toString(36).slice(2, 6)}`, label: "Rôle B", departmentId: dept.id } });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/departments/${dept.id}/permissions`,
      headers: { cookie: adminCookie },
      payload: { module: "stock", action: "consultation", granted: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().roles_affected).toBe(2);

    const perm = await prisma.permission.findUniqueOrThrow({ where: { module_action: { module: "stock", action: "consultation" } } });
    for (const roleId of [roleA.id, roleB.id]) {
      const rp = await prisma.rolePermission.findFirst({ where: { roleId, permissionId: perm.id } });
      expect(rp).not.toBeNull();
    }
  });

  it("refuse ces opérations d'administration à un profil non habilité (403)", async () => {
    await createUserWithRole("correcteur_super_test", "CORRECTEUR", "Correcteur123!");
    const cookie = await loginCookie(app, "correcteur_super_test", "Correcteur123!");
    const res = await app.inject({ method: "POST", url: `/api/v1/users/${adminId}/impersonate`, headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });
});
