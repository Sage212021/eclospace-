import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Suppression logique d'un contrat NON SIGNÉ (contrat de test). Interdite dès
// qu'une signature existe ou que le contrat est actif.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("suppression d'un contrat non signé", () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function newContract() {
    const partner = await prisma.partner.create({ data: { category: "auteur", firstName: "Test", lastName: `Del${rnd()}` } });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { cookie },
      payload: { type: "edition", partner_id: partner.id, financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.1 }] } },
    });
    return { id: res.json().id as string, partner };
  }

  it("supprime (logiquement) un contrat non signé et le retire de la liste", async () => {
    const { id } = await newContract();
    const del = await app.inject({ method: "DELETE", url: `/api/v1/contracts/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);
    expect(del.json().deleted).toBe(true);

    const row = await prisma.contract.findUnique({ where: { id } });
    expect(row?.deletedAt).not.toBeNull();

    const get = await app.inject({ method: "GET", url: `/api/v1/contracts/${id}`, headers: { cookie } });
    expect(get.statusCode).toBe(404);
  });

  it("refuse de supprimer un contrat signé/actif (409)", async () => {
    const { id, partner } = await newContract();
    for (const status of ["legal_review", "direction_approval", "awaiting_signature"]) {
      await app.inject({ method: "PATCH", url: `/api/v1/contracts/${id}/status`, headers: { cookie }, payload: { status } });
    }
    await app.inject({ method: "POST", url: `/api/v1/contracts/${id}/sign`, headers: { cookie }, payload: { party: "author", signer_name: `${partner.firstName} ${partner.lastName}`, consent: true } });

    const del = await app.inject({ method: "DELETE", url: `/api/v1/contracts/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(409);
    expect(del.json().code).toBe("contract_signed");

    const row = await prisma.contract.findUnique({ where: { id } });
    expect(row?.deletedAt).toBeNull();
  });

  it("404 sur un contrat inexistant", async () => {
    const del = await app.inject({ method: "DELETE", url: `/api/v1/contracts/00000000-0000-0000-0000-000000000000`, headers: { cookie } });
    expect(del.statusCode).toBe(404);
  });
});
