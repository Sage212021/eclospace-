import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { prisma } = await import("../src/lib/prisma.js");
const { extractSessionCookie } = await import("./helpers.js");

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

// Administration de la grille d'évaluation (critères + coefficients) : sert au
// comité de lecture ET au rapport d'évaluation IA.
describe("Grille d'évaluation — administration (critères + coefficients)", () => {
  let app: FastifyInstance;
  let adminCookie: string;

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login("admin", ADMIN_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("liste toutes les critères avec la somme des coefficients actifs", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/evaluation-criteria/all", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { criteria: unknown[]; active_coefficient_sum: number };
    expect(Array.isArray(body.criteria)).toBe(true);
    expect(body.active_coefficient_sum).toBeGreaterThan(0);
  });

  it("crée, modifie le coefficient, désactive puis réactive un critère", async () => {
    const label = `Critère test ${Math.random().toString(36).slice(2, 6)}`;
    const created = await app.inject({ method: "POST", url: "/api/v1/evaluation-criteria", headers: { cookie: adminCookie }, payload: { label, coefficient: 2 } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    const patched = await app.inject({ method: "PATCH", url: `/api/v1/evaluation-criteria/${id}`, headers: { cookie: adminCookie }, payload: { coefficient: 4 } });
    expect(patched.statusCode).toBe(200);
    expect(Number(patched.json().coefficient)).toBe(4);

    // Désactivation → n'apparaît plus dans la liste "active".
    const del = await app.inject({ method: "DELETE", url: `/api/v1/evaluation-criteria/${id}`, headers: { cookie: adminCookie } });
    expect(del.statusCode).toBe(200);
    const active = await app.inject({ method: "GET", url: "/api/v1/evaluation-criteria", headers: { cookie: adminCookie } });
    expect((active.json() as { id: string }[]).some((c) => c.id === id)).toBe(false);

    // Réactivation.
    const reactivate = await app.inject({ method: "PATCH", url: `/api/v1/evaluation-criteria/${id}`, headers: { cookie: adminCookie }, payload: { is_active: true } });
    expect(reactivate.statusCode).toBe(200);
    expect(reactivate.json().isActive).toBe(true);
  });

  it("refuse un coefficient invalide (≤ 0)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/evaluation-criteria", headers: { cookie: adminCookie }, payload: { label: "X", coefficient: 0 } });
    expect(res.statusCode).toBe(400);
  });
});
