import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Audit des accès (demande opérateur du 29/07/2026) : « qui détient tel accès
// sensible, et par quel rôle ? » — pour repérer une habilitation à tort.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("audit des accès", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let dgUser: string;
  let correcteurUser: string;

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    dgUser = `dg_${rnd()}`;
    correcteurUser = `corr_${rnd()}`;
    await createUserWithRole(dgUser, "DIR_GENERAL", "Passw0rd!"); // détient users:administration
    await createUserWithRole(correcteurUser, "CORRECTEUR", "Passw0rd!"); // ne le détient pas
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("liste les comptes détenant « users:administration » avec le rôle qui le donne", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/access-audit?permission=users:administration", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { holders: { username: string; via_roles: { code: string }[] }[] };
    const dg = body.holders.find((h) => h.username === dgUser);
    expect(dg).toBeTruthy();
    expect(dg!.via_roles.some((r) => r.code === "DIR_GENERAL")).toBe(true);
    // Un correcteur ne détient pas cet accès.
    expect(body.holders.some((h) => h.username === correcteurUser)).toBe(false);
  });

  it("la fonction RH ne détient plus l'accès « Utilisateurs & rôles » d'office", async () => {
    const rhUser = `rh_${rnd()}`;
    await createUserWithRole(rhUser, "RESP_RH", "Passw0rd!");
    const res = await app.inject({ method: "GET", url: "/api/v1/access-audit?permission=users:administration", headers: { cookie: adminCookie } });
    const body = res.json() as { holders: { username: string }[] };
    expect(body.holders.some((h) => h.username === rhUser)).toBe(false);
  });

  it("profil d'accès d'un compte : liste ses permissions avec le rôle qui les donne", async () => {
    const assistant = `assist_${rnd()}`;
    const created = await createUserWithRole(assistant, "ASSISTANT_EDITORIAL", "Passw0rd!");
    const res = await app.inject({ method: "GET", url: `/api/v1/users/${created.id}/access`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { permissions: { key: string; via_roles: { code: string }[] }[] };
    // L'assistant éditorial a bien l'accès ISBN (consultation), via son rôle.
    const isbn = body.permissions.find((p) => p.key === "isbn:consultation");
    expect(isbn).toBeTruthy();
    expect(isbn!.via_roles.some((r) => r.code === "ASSISTANT_EDITORIAL")).toBe(true);
  });

  it("refuse l'audit à un profil non administrateur (403)", async () => {
    const corrCookie = await loginCookie(app, correcteurUser, "Passw0rd!");
    const res = await app.inject({ method: "GET", url: "/api/v1/access-audit?permission=users:administration", headers: { cookie: corrCookie } });
    expect(res.statusCode).toBe(403);
  });
});
