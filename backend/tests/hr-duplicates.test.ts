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

  it("détecte un quasi-doublon (faute de frappe : NOAH MBA vs NOAH MBALA — 2 mots partagés)", async () => {
    const t2 = `${tag}X`;
    const e1 = await prisma.employee.create({ data: { firstName: `${t2} HERMAN`, lastName: "NOAH MBA" } });
    const e2 = await prisma.employee.create({ data: { firstName: `${t2} Herman`, lastName: "noah MBALA" } });
    try {
      const groups = (await app.inject({ method: "GET", url: "/api/v1/hr/duplicates", headers: { cookie } })).json().groups as Array<{ records: Array<{ employee_id: string }> }>;
      const grp = groups.find((g) => g.records.some((r) => r.employee_id === e1.id) && g.records.some((r) => r.employee_id === e2.id));
      expect(grp).toBeTruthy();
    } finally {
      await prisma.employee.deleteMany({ where: { id: { in: [e1.id, e2.id] } } }).catch(() => {});
    }
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

  it("une fiche supprimée apparaît dans la corbeille et peut être RESTAURÉE", async () => {
    // b a été supprimé au test précédent : il doit être dans la corbeille.
    const trash = (await app.inject({ method: "GET", url: "/api/v1/employees/deleted", headers: { cookie } })).json().deleted as Array<{ employee_id: string }>;
    expect(trash.some((t) => t.employee_id === b)).toBe(true);

    // Restauration.
    const res = await app.inject({ method: "POST", url: `/api/v1/employees/${b}/restore`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().restored).toBe(true);

    const row = await prisma.employee.findUnique({ where: { id: b } });
    expect(row?.deletedAt).toBeNull();

    // Restaurer une fiche déjà active → 404.
    const again = await app.inject({ method: "POST", url: `/api/v1/employees/${b}/restore`, headers: { cookie } });
    expect(again.statusCode).toBe(404);
  });
});
