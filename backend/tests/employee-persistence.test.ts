import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Lot 1a — PERSISTANCE de la fiche employé (Problème A du chantier RH).
// Jusqu'ici le PATCH /employees/:id ignorait silencieusement le nom, le prénom
// et la date d'embauche : les modifier « ne se sauvegardait pas ». On vérifie
// désormais qu'une modification est réellement persistée (Test 1 & 2 du cahier),
// et qu'une mise à jour partielle ne remet aucun autre champ à zéro.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const PWD = "Passw0rd!";
const rnd = () => Math.random().toString(36).slice(2, 7);

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("persistance de la fiche employé (nom / date d'embauche)", () => {
  let app: FastifyInstance;
  let cookie: string;
  const createdUsernames: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    const rhU = `rhpers_${rnd()}`;
    await createUserWithRole(rhU, "RESP_RH", PWD);
    createdUsernames.push(rhU);
    cookie = await loginCookie(app, rhU, PWD);
  });

  afterAll(async () => {
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

  async function createEmployee(): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/employees",
      headers: { cookie },
      payload: { first_name: "Ancien", last_name: "Nom", position: "Assistant", hire_date: "2024-01-15T00:00:00.000Z" },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  it("Test 1/2 — modifier nom, prénom et date d'embauche est réellement persisté", async () => {
    const id = await createEmployee();

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/employees/${id}`,
      headers: { cookie },
      payload: { first_name: "Nouveau", last_name: "Prénom", hire_date: "2025-03-01T00:00:00.000Z" },
    });
    expect(patch.statusCode).toBe(200);

    // Relecture depuis la base (comme un retour ultérieur sur la fiche).
    const got = await app.inject({ method: "GET", url: `/api/v1/employees/${id}`, headers: { cookie } });
    const body = got.json();
    expect(body.firstName).toBe("Nouveau");
    expect(body.lastName).toBe("Prénom");
    expect(String(body.hireDate).slice(0, 10)).toBe("2025-03-01");
  });

  it("situation familiale et nombre d'enfants (bulletin) sont persistés", async () => {
    const id = await createEmployee();
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/employees/${id}`,
      headers: { cookie },
      payload: { marital_status: "Marié(e)", children_count: 3 },
    });
    expect(patch.statusCode).toBe(200);

    const got = await app.inject({ method: "GET", url: `/api/v1/employees/${id}`, headers: { cookie } });
    const body = got.json();
    expect(body.maritalStatus).toBe("Marié(e)");
    expect(body.childrenCount).toBe(3);
  });

  it("numéro d'urgence (bulletin) est persisté et renvoyé", async () => {
    const id = await createEmployee();
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/employees/${id}`,
      headers: { cookie },
      payload: { emergency_contact: "Awa Bello — 690 00 00 00" },
    });
    expect(patch.statusCode).toBe(200);

    const got = await app.inject({ method: "GET", url: `/api/v1/employees/${id}`, headers: { cookie } });
    expect(got.json().emergencyContact).toBe("Awa Bello — 690 00 00 00");
  });

  it("une mise à jour partielle (poste seul) ne remet pas le nom à zéro", async () => {
    const id = await createEmployee();

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/employees/${id}`,
      headers: { cookie },
      payload: { position: "Chargé de mission" },
    });
    expect(patch.statusCode).toBe(200);

    const got = await app.inject({ method: "GET", url: `/api/v1/employees/${id}`, headers: { cookie } });
    const body = got.json();
    expect(body.position).toBe("Chargé de mission");
    // Le nom d'origine est conservé (aucun champ écrasé par la mise à jour partielle).
    expect(body.firstName).toBe("Ancien");
    expect(body.lastName).toBe("Nom");
    expect(String(body.hireDate).slice(0, 10)).toBe("2024-01-15");
  });
});
