import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Ajuster un contrat avant impression : surcharge du texte d'un article standard
// et remplacement de la liste des clauses additionnelles — sur contrat non signé.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const PWD = "Over123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string, p: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

async function newContract(app: FastifyInstance, cookie: string, adminId: string, genreId: string) {
  const partner = await prisma.partner.create({ data: { category: "auteur", firstName: "Ov", lastName: "Er" } });
  const m = await app.inject({ method: "POST", url: "/api/v1/manuscripts", headers: { cookie }, payload: { title: `Œuvre ${rnd()}`, genre_id: genreId, language: "fr", owner_id: adminId, author: { author_id: partner.id } } });
  const c = await app.inject({ method: "POST", url: "/api/v1/contracts", headers: { cookie }, payload: { type: "edition", manuscript_id: m.json().id, partner_id: partner.id, duration_months: 36, financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.1 }], advance_amount: 0, payment_schedule: "semestriel" } } });
  return c.json().id as string;
}

describe("ajuster le contrat avant impression", () => {
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

  it("surcharge le texte d'un article puis le rétablit", async () => {
    const id = await newContract(app, adminCookie, adminId, genreId);
    const res = await app.inject({ method: "PUT", url: `/api/v1/contracts/${id}/article-overrides`, headers: { cookie: adminCookie }, payload: { article: 3, text: "Texte ajusté de l'article 3 pour ce contrat." } });
    expect(res.statusCode).toBe(200);
    let c = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect((c.articleOverrides as Record<string, string>)["3"]).toContain("Texte ajusté");

    // Un texte vide rétablit le texte standard (retire la surcharge).
    const clear = await app.inject({ method: "PUT", url: `/api/v1/contracts/${id}/article-overrides`, headers: { cookie: adminCookie }, payload: { article: 3, text: "" } });
    expect(clear.statusCode).toBe(200);
    c = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect((c.articleOverrides as Record<string, string>)["3"]).toBeUndefined();
  });

  it("remplace la liste complète des clauses (modifier / retirer)", async () => {
    const id = await newContract(app, adminCookie, adminId, genreId);
    const res = await app.inject({ method: "PUT", url: `/api/v1/contracts/${id}/clauses`, headers: { cookie: adminCookie }, payload: { clauses: [{ title: "Clause A", body: "Corps de la clause A." }, { title: "Clause B", body: "Corps de la clause B." }] } });
    expect(res.statusCode).toBe(200);
    let c = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect((c.customClauses as { title: string }[]).length).toBe(2);

    // Nouveau remplacement : une seule clause conservée (les autres retirées).
    const repl = await app.inject({ method: "PUT", url: `/api/v1/contracts/${id}/clauses`, headers: { cookie: adminCookie }, payload: { clauses: [{ title: "Clause B", body: "Corps ajusté." }] } });
    expect(repl.statusCode).toBe(200);
    c = await prisma.contract.findUniqueOrThrow({ where: { id } });
    const clauses = c.customClauses as { title: string; body: string }[];
    expect(clauses.length).toBe(1);
    expect(clauses[0].title).toBe("Clause B");
    expect(clauses[0].body).toBe("Corps ajusté.");
  });

  it("refuse l'ajustement d'un contrat actif (409)", async () => {
    const id = await newContract(app, adminCookie, adminId, genreId);
    await prisma.contract.update({ where: { id }, data: { status: "active" } });
    const over = await app.inject({ method: "PUT", url: `/api/v1/contracts/${id}/article-overrides`, headers: { cookie: adminCookie }, payload: { article: 1, text: "Trop tard." } });
    expect(over.statusCode).toBe(409);
    expect(over.json().code).toBe("contract_signed");
    const clauses = await app.inject({ method: "PUT", url: `/api/v1/contracts/${id}/clauses`, headers: { cookie: adminCookie }, payload: { clauses: [{ title: "Trop tard", body: "Non modifiable." }] } });
    expect(clauses.statusCode).toBe(409);
  });

  it("refuse l'ajustement sans droit de saisie contrats (403)", async () => {
    const id = await newContract(app, adminCookie, adminId, genreId);
    const res = await app.inject({ method: "PUT", url: `/api/v1/contracts/${id}/article-overrides`, headers: { cookie: plainCookie }, payload: { article: 1, text: "Sans droit." } });
    expect(res.statusCode).toBe(403);
  });
});
