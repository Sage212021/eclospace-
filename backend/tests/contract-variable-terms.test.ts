import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Termes de contrat VARIABLES par auteur : base de calcul, paliers de droits
// progressifs, retenue fiscale, périodicité des relevés.

const rnd = () => Math.random().toString(36).slice(2, 8);
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("contrat à termes variables par auteur", () => {
  let app: FastifyInstance;
  let cookie: string;
  let partnerId: string;
  const createdIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));
    const partner = await prisma.partner.create({ data: { firstName: "Var", lastName: `Terms-${rnd()}`, category: "auteur" } });
    partnerId = partner.id;
  });

  afterAll(async () => {
    await prisma.royaltyTerms.deleteMany({ where: { contractId: { in: createdIds } } });
    await prisma.contract.deleteMany({ where: { partnerId } });
    await prisma.partner.delete({ where: { id: partnerId } }).catch(() => {});
    await app.close();
  });

  it("enregistre des paliers progressifs + base + retenue + périodicité", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/contracts", headers: { cookie },
      payload: {
        type: "edition", partner_id: partnerId,
        financial_terms: {
          base: "prix_net_editeur",
          tiers: [{ up_to: 3000, rate: 0.1 }, { up_to: null, rate: 0.12 }],
          advance_amount: 150000,
          payment_schedule: "semestriel",
          statement_periodicity: "annuelle",
          tax_withholding_pct: 5.5,
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    createdIds.push(id);

    const rt = await prisma.royaltyTerms.findUnique({ where: { contractId: id } });
    expect(rt).not.toBeNull();
    expect(rt!.base).toBe("prix_net_editeur");
    expect(rt!.statementPeriodicity).toBe("annuelle");
    expect(Number(rt!.taxWithholdingPct)).toBe(5.5);
    expect(Number(rt!.advanceAmount)).toBe(150000);
    const tiers = rt!.tiers as Array<{ up_to: number | null; rate: number }>;
    expect(tiers).toHaveLength(2);
    expect(tiers[0]).toMatchObject({ up_to: 3000, rate: 0.1 });
    expect(tiers[1]).toMatchObject({ up_to: null, rate: 0.12 });
  });

  it("refuse un palier hors bornes 8–15 % (même en multi-paliers)", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/contracts", headers: { cookie },
      payload: {
        type: "edition", partner_id: partnerId,
        financial_terms: { base: "prix_public_ht", tiers: [{ up_to: 3000, rate: 0.1 }, { up_to: null, rate: 0.2 }] },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("royalty_rate_out_of_bounds");
  });
});
