import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Modifier les termes d'un contrat non signé + ajouter un article (clause).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const PWD = "Terms123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string, p: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

async function newContract(app: FastifyInstance, cookie: string, adminId: string, genreId: string) {
  const partner = await prisma.partner.create({ data: { category: "auteur", firstName: "Ter", lastName: "Mes" } });
  const m = await app.inject({ method: "POST", url: "/api/v1/manuscripts", headers: { cookie }, payload: { title: `Œuvre ${rnd()}`, genre_id: genreId, language: "fr", owner_id: adminId, author: { author_id: partner.id } } });
  const c = await app.inject({ method: "POST", url: "/api/v1/contracts", headers: { cookie }, payload: { type: "edition", manuscript_id: m.json().id, partner_id: partner.id, duration_months: 36, financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.1 }], advance_amount: 0, payment_schedule: "semestriel" } } });
  return c.json().id as string;
}

describe("modifier les termes & ajouter un article", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let plainCookie: string;
  let adminId: string;
  let genreId: string;

  beforeAll(async () => {
    app = await buildApp();
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    adminCookie = await login(app, "admin", ADMIN_PASSWORD);
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
    const u = `corr_${rnd()}`;
    await createUserWithRole(u, "CORRECTEUR", PWD); // pas de droit contrats:saisie
    plainCookie = await login(app, u, PWD);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("modifie taux, avance et durée d'un contrat non signé", async () => {
    const id = await newContract(app, adminCookie, adminId, genreId);
    const res = await app.inject({ method: "PATCH", url: `/api/v1/contracts/${id}/terms`, headers: { cookie: adminCookie }, payload: { type: "coedition", rate: 0.14, advance_amount: 50000, duration_months: 48 } });
    expect(res.statusCode).toBe(200);
    const c = await prisma.contract.findUniqueOrThrow({ where: { id }, include: { royaltyTerms: true } });
    expect(c.type).toBe("coedition");
    expect(c.durationMonths).toBe(48);
    expect(Number((c.royaltyTerms!.tiers as { rate: number }[])[0].rate)).toBeCloseTo(0.14);
    expect(Number(c.royaltyTerms!.advanceAmount)).toBe(50000);
  });

  it("ajoute un article (clause) puis le relit", async () => {
    const id = await newContract(app, adminCookie, adminId, genreId);
    const res = await app.inject({ method: "POST", url: `/api/v1/contracts/${id}/clauses`, headers: { cookie: adminCookie }, payload: { title: "Clause de confidentialité", body: "Les parties s'engagent à la confidentialité des termes." } });
    expect(res.statusCode).toBe(201);
    const c = await prisma.contract.findUniqueOrThrow({ where: { id } });
    const clauses = c.customClauses as { title: string }[];
    expect(clauses.length).toBe(1);
    expect(clauses[0].title).toBe("Clause de confidentialité");
  });

  it("refuse toute modification d'un contrat actif (409)", async () => {
    const id = await newContract(app, adminCookie, adminId, genreId);
    await prisma.contract.update({ where: { id }, data: { status: "active" } });
    const terms = await app.inject({ method: "PATCH", url: `/api/v1/contracts/${id}/terms`, headers: { cookie: adminCookie }, payload: { rate: 0.12 } });
    expect(terms.statusCode).toBe(409);
    const clause = await app.inject({ method: "POST", url: `/api/v1/contracts/${id}/clauses`, headers: { cookie: adminCookie }, payload: { title: "Trop tard", body: "Non modifiable." } });
    expect(clause.statusCode).toBe(409);
  });

  it("refuse la modification sans droit de saisie contrats (403)", async () => {
    const id = await newContract(app, adminCookie, adminId, genreId);
    const res = await app.inject({ method: "PATCH", url: `/api/v1/contracts/${id}/terms`, headers: { cookie: plainCookie }, payload: { rate: 0.12 } });
    expect(res.statusCode).toBe(403);
  });
});
