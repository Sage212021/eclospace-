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

  it("un administrateur réinitialise le mot de passe d'un compte, l'utilisateur se reconnecte avec", async () => {
    const cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const suffix = Math.random().toString(36).slice(2, 7);
    const target = await createUserWithRole(`reset_${suffix}`, "CORRECTEUR", "Ancien123!");

    const before = await prisma.auditLog.count({ where: { entityType: "user", entityId: target.id } });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/users/${target.id}/reset-password`,
      headers: { cookie },
      payload: { new_password: "Nouveau456!" },
    });
    expect(res.statusCode).toBe(200);

    // Tracé au journal d'audit (sans jamais y écrire le mot de passe) — mesuré
    // avant les connexions de contrôle, qui produisent leurs propres entrées.
    const after = await prisma.auditLog.count({ where: { entityType: "user", entityId: target.id } });
    expect(after).toBe(before + 1);

    // L'ancien mot de passe ne fonctionne plus, le nouveau oui.
    const oldLogin = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: target.username, password: "Ancien123!" } });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: target.username, password: "Nouveau456!" } });
    expect(newLogin.statusCode).toBe(200);
  });

  it("refuse un mot de passe trop faible à la réinitialisation (400)", async () => {
    const cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const target = await createUserWithRole(`reset_weak_${Math.random().toString(36).slice(2, 7)}`, "CORRECTEUR", "Ancien123!");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/users/${target.id}/reset-password`,
      headers: { cookie },
      payload: { new_password: "faible" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("weak_password");
  });

  it("refuse la réinitialisation à un profil sans habilitation users:administration (403)", async () => {
    const target = await createUserWithRole(`reset_target_${Math.random().toString(36).slice(2, 7)}`, "CORRECTEUR", "Ancien123!");
    await createUserWithRole("correcteur_reset_test", "CORRECTEUR", "Correcteur123!");
    const cookie = await loginCookie(app, "correcteur_reset_test", "Correcteur123!");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/users/${target.id}/reset-password`,
      headers: { cookie },
      payload: { new_password: "Nouveau456!" },
    });
    expect(res.statusCode).toBe(403);
  });

  // Cloisonnement des pôles (décision opérateur 19/07/2026) : un responsable
  // opérationnel ne doit voir NI le module RH NI les Rapports. Ces droits
  // restent réservés au RH et à la Direction. Le menu de l'interface est piloté
  // par ces permissions renvoyées par /me.
  async function meFor(username: string, password: string, roleCode: string): Promise<string[]> {
    await createUserWithRole(username, roleCode, password);
    const cookie = await loginCookie(app, username, password);
    const res = await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    return res.json().permissions as string[];
  }

  it("un responsable commercial ne voit ni le module RH ni les Rapports", async () => {
    const s = Math.random().toString(36).slice(2, 7);
    const perms = await meFor(`comm_cloison_${s}`, "Commercial123!", "RESP_COMMERCIAL");
    // Son périmètre métier reste intact…
    expect(perms).toContain("commercial:consultation");
    expect(perms).toContain("stock:consultation");
    // …mais il n'a PAS accès au RH ni aux Rapports.
    expect(perms).not.toContain("rh:consultation");
    expect(perms).not.toContain("rapports:consultation");
  });

  it("un responsable infographie non plus (cloisonnement des responsables opérationnels)", async () => {
    const s = Math.random().toString(36).slice(2, 7);
    const perms = await meFor(`info_cloison_${s}`, "Infographie123!", "RESP_INFOGRAPHIE");
    expect(perms).not.toContain("rh:consultation");
    expect(perms).not.toContain("rapports:consultation");
  });

  // Le juridique a besoin de consulter les manuscrits (pour les contrats), mais
  // NE doit PAS accéder à la Production. Les modules Production dépendent des
  // droits métier (production/isbn/bat/printing), pas du droit « manuscrits ».
  it("le juridique garde les manuscrits (contrats) mais n'accède pas à la Production", async () => {
    const s = Math.random().toString(36).slice(2, 7);
    const perms = await meFor(`jur_${s}`, "Juridique123!", "RESP_JURIDIQUE");
    expect(perms).toContain("manuscripts:consultation"); // pour ses contrats
    for (const p of ["production:consultation", "isbn:consultation", "bat:consultation", "printing:consultation"]) {
      expect(perms, `juridique ne doit pas avoir ${p}`).not.toContain(p);
    }
  });

  it("la Direction éditoriale garde la vue complète de la Production", async () => {
    const s = Math.random().toString(36).slice(2, 7);
    const perms = await meFor(`dired_${s}`, "DirEd123!", "DIR_EDITORIAL");
    for (const p of ["production:consultation", "isbn:consultation", "bat:consultation", "printing:consultation"]) {
      expect(perms, `la direction éditoriale doit voir ${p}`).toContain(p);
    }
  });

  it("le RH et la Direction gardent bien l'accès RH et Rapports", async () => {
    const s = Math.random().toString(36).slice(2, 7);
    const rh = await meFor(`rh_ok_${s}`, "RhAcces123!", "RESP_RH");
    expect(rh).toContain("rh:consultation");
    expect(rh).toContain("rapports:consultation");
    const dg = await meFor(`dg_ok_${s}`, "DgAcces123!", "DIR_GENERAL");
    expect(dg).toContain("rh:consultation");
    expect(dg).toContain("rapports:consultation");
  });

  // Réutilisation d'un e-mail/identifiant après suppression (bug signalé) : un
  // compte supprimé occupait encore l'e-mail et bloquait la création d'un
  // nouveau compte avec une erreur technique brute. On vérifie que la
  // suppression libère les identifiants et qu'un message clair remplace l'erreur.
  it("permet de réutiliser l'e-mail et l'identifiant d'un compte supprimé", async () => {
    const cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const s = Math.random().toString(36).slice(2, 7);
    const email = `reuse_${s}@eclosion.cm`;
    const username = `reuse_${s}`;

    const first = await app.inject({ method: "POST", url: "/api/v1/users", headers: { cookie }, payload: { username, email, password: "Eclosion2026", role_codes: [] } });
    expect(first.statusCode).toBe(201);
    const firstId = first.json().id;

    const del = await app.inject({ method: "DELETE", url: `/api/v1/users/${firstId}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);

    // Même e-mail + même identifiant : doit maintenant réussir (identifiants libérés).
    const second = await app.inject({ method: "POST", url: "/api/v1/users", headers: { cookie }, payload: { username, email, password: "Eclosion2026", role_codes: ["DIR_GENERAL"] } });
    expect(second.statusCode).toBe(201);
    expect(second.json().email).toBe(email);
    expect(second.json().id).not.toBe(firstId);
  });

  it("refuse un e-mail déjà utilisé par un compte actif avec un message clair (pas d'erreur brute)", async () => {
    const cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const s = Math.random().toString(36).slice(2, 7);
    const email = `dup_${s}@eclosion.cm`;
    const a = await app.inject({ method: "POST", url: "/api/v1/users", headers: { cookie }, payload: { username: `dupA_${s}`, email, password: "Eclosion2026", role_codes: [] } });
    expect(a.statusCode).toBe(201);
    const b = await app.inject({ method: "POST", url: "/api/v1/users", headers: { cookie }, payload: { username: `dupB_${s}`, email, password: "Eclosion2026", role_codes: [] } });
    expect(b.statusCode).toBe(409);
    expect(b.json().message).toContain("déjà utilisé");
    expect(JSON.stringify(b.json())).not.toContain("prisma"); // jamais d'erreur technique brute
  });
});
