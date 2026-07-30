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
});
