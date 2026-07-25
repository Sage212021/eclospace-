import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Taux de droits d'auteur réglable par ouvrage, borné 8 %–15 % (décision
// opérateur). Contrôle serveur à la création du contrat.

const rnd = () => Math.random().toString(36).slice(2, 8);
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("taux de droits d'auteur borné 8 %–15 %", () => {
  let app: FastifyInstance;
  let cookie: string;
  let partnerId: string;
  const createdIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));
    const partner = await prisma.partner.create({ data: { firstName: "Ren", lastName: `Ateba-${rnd()}`, category: "auteur" } });
    partnerId = partner.id;
  });

  afterAll(async () => {
    await prisma.royaltyTerms.deleteMany({ where: { contractId: { in: createdIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.contract.deleteMany({ where: { partnerId } });
    await prisma.partner.delete({ where: { id: partnerId } });
    await app.close();
  });

  const create = (rate: number) =>
    app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { cookie },
      payload: { type: "edition", partner_id: partnerId, financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate }] } },
    });

  it("accepte un taux dans les bornes (8 %, 10 %, 15 %)", async () => {
    for (const rate of [0.08, 0.1, 0.15]) {
      const res = await create(rate);
      expect(res.statusCode).toBe(201);
      createdIds.push(res.json().id);
    }
  });

  it("refuse un taux sous 8 %", async () => {
    const res = await create(0.07);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("royalty_rate_out_of_bounds");
  });

  it("refuse un taux au-dessus de 15 %", async () => {
    const res = await create(0.2);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("royalty_rate_out_of_bounds");
  });
});
