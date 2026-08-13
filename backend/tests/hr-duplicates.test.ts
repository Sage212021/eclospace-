import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Détection des doublons d'employés + suppression logique guidée.

describe("doublons d'employés", () => {
  let app: FastifyInstance;
  let cookie: string;
  let a: string; let b: string;
  const tag = `DUP${Date.now()}`;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!" } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
    // Deux fiches = même personne, écrites différemment (casse + accents).
    const e1 = await prisma.employee.create({ data: { firstName: `${tag} Évrard`, lastName: "NDI" } });
    const e2 = await prisma.employee.create({ data: { firstName: `${tag} EVRARD`, lastName: "ndi" } });
    a = e1.id; b = e2.id;
  });

  afterAll(async () => {
    await prisma.employee.deleteMany({ where: { id: { in: [a, b] } } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("détecte les deux fiches comme un même groupe (insensible casse/accents)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/hr/duplicates", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const groups = res.json().groups as Array<{ records: Array<{ employee_id: string }> }>;
    const grp = groups.find((g) => g.records.some((r) => r.employee_id === a) && g.records.some((r) => r.employee_id === b));
    expect(grp).toBeTruthy();
    expect(grp!.records.length).toBe(2);
  });

  it("supprime UNE fiche (doublon) et conserve l'autre", async () => {
    const del = await app.inject({ method: "DELETE", url: `/api/v1/employees/${b}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);
    expect(del.json().deleted).toBe(true);

    // b est en suppression logique (deletedAt), a reste actif.
    const rowB = await prisma.employee.findUnique({ where: { id: b } });
    const rowA = await prisma.employee.findUnique({ where: { id: a } });
    expect(rowB?.deletedAt).not.toBeNull();
    expect(rowA?.deletedAt).toBeNull();

    // Le groupe de doublons a disparu (il ne reste qu'une fiche active).
    const groups = (await app.inject({ method: "GET", url: "/api/v1/hr/duplicates", headers: { cookie } })).json().groups as Array<{ records: Array<{ employee_id: string }> }>;
    const stillDup = groups.find((g) => g.records.some((r) => r.employee_id === a) && g.records.length > 1);
    expect(stillDup).toBeFalsy();
  });

  it("renvoie 404 pour une fiche inexistante", async () => {
    const del = await app.inject({ method: "DELETE", url: "/api/v1/employees/00000000-0000-0000-0000-000000000000", headers: { cookie } });
    expect(del.statusCode).toBe(404);
  });
});
