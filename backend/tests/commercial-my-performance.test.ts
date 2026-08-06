import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Tableau de bord individuel « Mes performances » : strictement personnel ;
// un responsable peut cibler un rep ou consolider (rep=all).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const PWD = "Perf123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string, p: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

describe("commercial — mes performances", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let repCookie: string;

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login(app, "admin", ADMIN_PASSWORD);
    // Un commercial simple (consultation) sans droit de validation.
    const rep = `com_${rnd()}`;
    await createUserWithRole(rep, "RESP_COMMERCIAL", PWD);
    repCookie = await login(app, rep, PWD);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("renvoie un tableau de bord individuel avec les KPI attendus", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/commercial/my-performance", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.scope).toBe("individual");
    for (const k of ["revenue", "sales_count", "orders_count", "avg_sale", "transformation_rate", "new_customers", "top_customers", "top_books", "by_period", "series", "payments"]) {
      expect(b).toHaveProperty(k);
    }
    expect(Array.isArray(b.top_customers)).toBe(true);
  });

  it("un responsable peut consolider l'équipe (rep=all)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/commercial/my-performance?rep=all", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().scope).toBe("consolidated");
    expect(res.json().can_see_others).toBe(true);
  });

  it("refuse les dates invalides (400)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/commercial/my-performance?from=pas-une-date", headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(400);
  });

  it("refuse sans session (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/commercial/my-performance" });
    expect(res.statusCode).toBe(401);
  });

  it("un responsable commercial voit son propre périmètre par défaut", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/commercial/my-performance", headers: { cookie: repCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().scope).toBe("individual");
  });

  it("objectif : définition (responsable) puis taux de réalisation dans le tableau de bord", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    const year = new Date().getFullYear();
    const put = await app.inject({ method: "PUT", url: "/api/v1/commercial/targets", headers: { cookie: adminCookie }, payload: { user_id: admin.id, year, target_revenue: 1000000 } });
    expect(put.statusCode).toBe(200);
    expect(put.json().target_revenue).toBe(1000000);

    const perf = await app.inject({ method: "GET", url: "/api/v1/commercial/my-performance", headers: { cookie: adminCookie } });
    expect(perf.json().objective).not.toBeNull();
    expect(perf.json().objective.target_revenue).toBe(1000000);
    expect(perf.json().objective).toHaveProperty("realization_pct");
  });

  it("objectif : un commercial simple ne peut pas en définir (403)", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
    // RESP_COMMERCIAL a la validation → autorisé ; on vérifie plutôt qu'un rôle
    // sans validation est refusé via un correcteur.
    const corr = `corr_${rnd()}`;
    await createUserWithRole(corr, "CORRECTEUR", PWD);
    const corrCookie = await login(app, corr, PWD);
    const res = await app.inject({ method: "PUT", url: "/api/v1/commercial/targets", headers: { cookie: corrCookie }, payload: { user_id: admin.id, year: 2026, target_revenue: 500000 } });
    expect(res.statusCode).toBe(403);
  });
});
