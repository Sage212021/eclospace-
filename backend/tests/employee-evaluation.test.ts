import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Évaluation annuelle du collaborateur (note + objectifs individuels).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const PWD = "Eval123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string, p: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

describe("évaluation annuelle du collaborateur", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let plainCookie: string;
  let employeeId: string;

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login(app, "admin", ADMIN_PASSWORD);
    const u = `corr_${rnd()}`;
    await createUserWithRole(u, "CORRECTEUR", PWD); // pas de droit rh
    plainCookie = await login(app, u, PWD);
    const emp = await prisma.employee.create({ data: { firstName: "Éva", lastName: "Luation" } });
    employeeId = emp.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("enregistre une évaluation puis la relit (upsert par année)", async () => {
    const put = await app.inject({
      method: "PUT",
      url: `/api/v1/employees/${employeeId}/evaluations`,
      headers: { cookie: adminCookie },
      payload: { year: 2026, rating: 4, strengths: "Rigueur", areas_to_improve: "Délais", objectives: "Prendre un dossier transverse" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().rating).toBe(4);

    // Upsert : même année → mise à jour, pas de doublon.
    await app.inject({ method: "PUT", url: `/api/v1/employees/${employeeId}/evaluations`, headers: { cookie: adminCookie }, payload: { year: 2026, rating: 5 } });
    const list = await app.inject({ method: "GET", url: `/api/v1/employees/${employeeId}/evaluations`, headers: { cookie: adminCookie } });
    const rows = list.json() as { year: number; rating: number }[];
    expect(rows.filter((r) => r.year === 2026).length).toBe(1);
    expect(rows.find((r) => r.year === 2026)!.rating).toBe(5);
  });

  it("refuse une note hors bornes (400)", async () => {
    const res = await app.inject({ method: "PUT", url: `/api/v1/employees/${employeeId}/evaluations`, headers: { cookie: adminCookie }, payload: { year: 2025, rating: 9 } });
    expect(res.statusCode).toBe(400);
  });

  it("refuse l'enregistrement sans droit RH (403)", async () => {
    const res = await app.inject({ method: "PUT", url: `/api/v1/employees/${employeeId}/evaluations`, headers: { cookie: plainCookie }, payload: { year: 2026, rating: 3 } });
    expect(res.statusCode).toBe(403);
  });
});
