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

describe("journal d'activité (audit-log)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("expose le journal en lecture, filtrable par action, à un profil d'oversight", async () => {
    const cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);

    // La connexion ci-dessus a elle-même produit une entrée d'audit "login".
    const res = await app.inject({ method: "GET", url: "/api/v1/audit-log?action=login&limit=10", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.total).toBe("number");
    expect(Array.isArray(body.entries)).toBe(true);
    for (const entry of body.entries) {
      expect(entry.action).toBe("login");
    }
  });

  it("refuse la consultation à un profil sans habilitation d'oversight (403)", async () => {
    await createUserWithRole("correcteur_audit_test", "CORRECTEUR", "Correcteur123!");
    const cookie = await loginCookie(app, "correcteur_audit_test", "Correcteur123!");
    const res = await app.inject({ method: "GET", url: "/api/v1/audit-log", headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it("reste strictement en lecture seule : aucune route n'écrit ni ne modifie le journal", async () => {
    const cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const post = await app.inject({ method: "POST", url: "/api/v1/audit-log", headers: { cookie }, payload: {} });
    // Aucune route POST déclarée -> 404 (jamais une écriture acceptée).
    expect(post.statusCode).toBe(404);
  });

  it("journalise la déconnexion (symétrique de la connexion)", async () => {
    const user = await createUserWithRole("logout_audit_test", "CORRECTEUR", "Correcteur123!");
    const cookie = await loginCookie(app, "logout_audit_test", "Correcteur123!");

    const before = await prisma.auditLog.count({ where: { userId: user.id, action: "logout" } });
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const after = await prisma.auditLog.count({ where: { userId: user.id, action: "logout" } });
    expect(after).toBe(before + 1);
  });

  it("journalise toute tentative d'accès refusée (403) avec la permission manquante", async () => {
    const user = await createUserWithRole("denied_audit_test", "CORRECTEUR", "Correcteur123!");
    const cookie = await loginCookie(app, "denied_audit_test", "Correcteur123!");

    // Le correcteur n'a pas « direction:consultation » : l'accès au journal est
    // refusé (403) et cette tentative doit elle-même être tracée.
    const res = await app.inject({ method: "GET", url: "/api/v1/audit-log", headers: { cookie } });
    expect(res.statusCode).toBe(403);

    // L'écriture du journal est asynchrone (non bloquante) : petite attente.
    await new Promise((r) => setTimeout(r, 100));
    const entry = await prisma.auditLog.findFirst({
      where: { userId: user.id, action: "access_denied", entityId: "direction:consultation" },
      orderBy: { occurredAt: "desc" },
    });
    expect(entry).not.toBeNull();
    const values = entry?.newValues as Record<string, unknown> | null;
    expect(values?.url).toContain("/api/v1/audit-log");
  });
});
