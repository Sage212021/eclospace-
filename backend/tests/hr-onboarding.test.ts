import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Embauche cohérente (audit RH du 30/07/2026) : créer un dossier collaborateur
// ouvre, si demandé, son compte de connexion avec le rôle du poste — dans le
// même mouvement. Garde-fou : ouvrir un compte à l'embauche ne doit pas
// permettre d'accorder un rôle de GESTION DES COMPTES à qui n'a pas ce droit.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const PWD = "Passw0rd!";
const rnd = () => Math.random().toString(36).slice(2, 7);

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("embauche : dossier + compte, avec garde-fou anti-escalade", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let rhCookie: string;
  const createdUsernames: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const rhU = `rhmgr_${rnd()}`;
    await createUserWithRole(rhU, "RESP_RH", PWD);
    rhCookie = await loginCookie(app, rhU, PWD);
    createdUsernames.push(rhU);
  });

  afterAll(async () => {
    // Nettoyage au meilleur effort : on suspend les comptes de test (une
    // suppression franche buterait sur les références d'audit — audit_log
    // append-only). Sans incidence sur les autres suites.
    for (const username of createdUsernames) {
      try {
        await prisma.user.updateMany({ where: { username }, data: { status: "disabled" } });
      } catch {
        /* nettoyage non bloquant */
      }
    }
    await app.close();
    await prisma.$disconnect();
  });

  async function hire(cookie: string, roleCode: string) {
    const username = `hire_${rnd()}`;
    createdUsernames.push(username);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/employees",
      headers: { cookie },
      payload: {
        first_name: "Nouveau",
        last_name: "Venu",
        status: "salarie",
        account: { username, email: `${username}@eclosion.test`, password: PWD, role_code: roleCode },
      },
    });
    return { res, username };
  }

  it("la RH crée un dossier + un compte au rôle non-admin (le compte peut se connecter)", async () => {
    const { res, username } = await hire(rhCookie, "CORRECTEUR");
    expect(res.statusCode).toBe(201);
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: PWD } });
    expect(login.statusCode).toBe(200);
  });

  it("la RH ne peut PAS ouvrir un compte à un rôle de gestion des comptes (403)", async () => {
    const { res, username } = await hire(rhCookie, "DIR_GENERAL"); // DIR_GENERAL détient users:administration
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("forbidden_role");
    // Aucun compte n'a été créé.
    const user = await prisma.user.findUnique({ where: { username } });
    expect(user).toBeNull();
  });

  it("l'administrateur, lui, peut ouvrir un compte à un rôle de gestion", async () => {
    const { res } = await hire(adminCookie, "DIR_GENERAL");
    expect(res.statusCode).toBe(201);
  });

  // Régularisation « compte actif sans dossier RH » (audit RH du 30/07/2026) :
  // un compte ouvert par l'administrateur sans fiche employé peut être rattaché
  // à un nouveau dossier — sans recréer de compte ni de mot de passe.
  it("rattache un compte existant (sans dossier) à un nouveau dossier RH", async () => {
    const username = `orphan_${rnd()}`;
    createdUsernames.push(username);
    const orphan = await createUserWithRole(username, "CORRECTEUR", PWD);
    expect(orphan.employeeId).toBeNull();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/employees",
      headers: { cookie: rhCookie },
      payload: { first_name: "Compte", last_name: "Régularisé", status: "salarie", link_user_id: orphan.id },
    });
    expect(res.statusCode).toBe(201);
    const employeeId = res.json().id;

    // Le compte pointe désormais sur le dossier, et aucun nouveau compte n'a été créé.
    const linked = await prisma.user.findUnique({ where: { id: orphan.id } });
    expect(linked?.employeeId).toBe(employeeId);
    // Le compte peut toujours se connecter avec son mot de passe d'origine.
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: PWD } });
    expect(login.statusCode).toBe(200);
  });

  it("refuse un rattachement + une ouverture de compte simultanés (exclusifs)", async () => {
    const username = `dup_${rnd()}`;
    createdUsernames.push(username);
    const target = await createUserWithRole(username, "CORRECTEUR", PWD);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/employees",
      headers: { cookie: rhCookie },
      payload: {
        first_name: "Conflit",
        last_name: "Test",
        status: "salarie",
        link_user_id: target.id,
        account: { username: `x_${rnd()}`, email: `x${rnd()}@eclosion.test`, password: PWD, role_code: "CORRECTEUR" },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuse le rattachement d'un compte déjà pourvu d'un dossier (409)", async () => {
    // Le compte admin possède déjà un dossier via le seed ? Sinon on en fabrique un.
    const username = `taken_${rnd()}`;
    createdUsernames.push(username);
    const user = await createUserWithRole(username, "CORRECTEUR", PWD);
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/employees",
      headers: { cookie: rhCookie },
      payload: { first_name: "Déjà", last_name: "Lié", status: "salarie", link_user_id: user.id },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/employees",
      headers: { cookie: rhCookie },
      payload: { first_name: "Encore", last_name: "Lié", status: "salarie", link_user_id: user.id },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("already_linked");
  });
});
