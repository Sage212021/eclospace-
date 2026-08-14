import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Cloisonnement commercial :
// - un commercial SIMPLE ne voit que le CA de SES ventes (pas le CA global) ;
// - le responsable commercial voit la performance de CHAQUE commercial + le total.

describe("performance commerciale par vendeur", () => {
  let app: FastifyInstance;
  let respCookie: string; // responsable commercial (voit tout)
  let c1Cookie: string; // commercial simple 1
  let c2Cookie: string; // commercial simple 2
  let c1: { id: string };
  let c2: { id: string };
  const s = Math.random().toString(36).slice(2, 6);

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };
  const sell = (cookie: string, amount: number) =>
    app.inject({ method: "POST", url: "/api/v1/pos-sales", headers: { cookie }, payload: { off_catalogue_title: `Vente ${s}`, quantity: 1, unit_price: amount, payment_method: "cash" } });

  beforeAll(async () => {
    app = await buildApp();
    await createUserWithRole(`resp_${s}`, "RESP_COMMERCIAL", "Resp123!");
    c1 = await createUserWithRole(`com1_${s}`, "COMMERCIAL", "Com1pass!");
    c2 = await createUserWithRole(`com2_${s}`, "COMMERCIAL", "Com2pass!");
    respCookie = await login(`resp_${s}`, "Resp123!");
    c1Cookie = await login(`com1_${s}`, "Com1pass!");
    c2Cookie = await login(`com2_${s}`, "Com2pass!");
    // Ventes attribuées : C1 = 10 000, C2 = 25 000.
    expect((await sell(c1Cookie, 10000)).statusCode).toBe(201);
    expect((await sell(c2Cookie, 25000)).statusCode).toBe(201);
  });

  afterAll(async () => {
    await prisma.posSale.deleteMany({ where: { offCatalogueTitle: `Vente ${s}` } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("le responsable voit la performance de chaque commercial + le total équipe", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/commercial/team-performance", headers: { cookie: respCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { reps: Array<{ user_id: string | null; revenue: number }>; total: { revenue: number } };
    const r1 = body.reps.find((r) => r.user_id === c1.id);
    const r2 = body.reps.find((r) => r.user_id === c2.id);
    expect(r1?.revenue).toBe(10000);
    expect(r2?.revenue).toBe(25000);
    expect(body.total.revenue).toBeGreaterThanOrEqual(35000); // au moins nos deux ventes
  });

  it("un commercial simple n'accède PAS à la performance de l'équipe (403)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/commercial/team-performance", headers: { cookie: c1Cookie } });
    expect(res.statusCode).toBe(403);
  });

  it("sur l'accueil, un commercial simple voit SON CA (scope own), pas le CA global", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/dashboard/stats", headers: { cookie: c1Cookie } });
    const body = res.json();
    expect(body.chiffre_affaires_scope).toBe("own");
    expect(body.chiffre_affaires).toBe(10000); // uniquement sa vente
  });

  it("sur l'accueil, le responsable voit le CA de l'ÉQUIPE commerciale (scope team)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/dashboard/stats", headers: { cookie: respCookie } });
    const body = res.json();
    expect(body.chiffre_affaires_scope).toBe("team");
    // Le total équipe inclut au moins nos deux ventes (10 000 + 25 000).
    expect(body.chiffre_affaires).toBeGreaterThanOrEqual(35000);
  });

  it("un profil Direction voit le CA GLOBAL de l'entreprise (scope company)", async () => {
    const adminCookie = await login("admin", process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!");
    const res = await app.inject({ method: "GET", url: "/api/v1/dashboard/stats", headers: { cookie: adminCookie } });
    expect(res.json().chiffre_affaires_scope).toBe("company");
  });
});
