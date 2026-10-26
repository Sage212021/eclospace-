import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Modèle économique du contrat (D-054, 25/10/2026) : axe distinct du type. La
// fourchette 8–15 % ne s'impose plus qu'à une édition à compte d'éditeur ; les
// autres modèles/types ont un taux libre, et un contrat de prestation / à compte
// d'auteur n'a pas de droits d'auteur (pas de RoyaltyTerms).

const rnd = () => Math.random().toString(36).slice(2, 8);
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("modèle économique & applicabilité des droits (D-054)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let partnerId: string;
  const createdIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));
    const partner = await prisma.partner.create({ data: { firstName: "Mina", lastName: `Nkeng-${rnd()}`, category: "auteur" } });
    partnerId = partner.id;
  });

  afterAll(async () => {
    await prisma.royaltyTerms.deleteMany({ where: { contractId: { in: createdIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.contract.deleteMany({ where: { partnerId } });
    await prisma.partner.delete({ where: { id: partnerId } });
    await app.close();
  });

  const create = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/v1/contracts", headers: { cookie }, payload: { partner_id: partnerId, ...payload } });

  it("édition à compte d'éditeur : la fourchette 8–15 % reste imposée", async () => {
    const res = await create({ type: "edition", economic_model: "compte_editeur", financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.2 }] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("royalty_rate_out_of_bounds");
  });

  it("traduction à compte à demi : taux LIBRE (25 % accepté) et droits enregistrés", async () => {
    const res = await create({ type: "traduction", economic_model: "compte_demi", financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.25 }] } });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    createdIds.push(id);
    const terms = await prisma.royaltyTerms.findUnique({ where: { contractId: id } });
    expect(terms).not.toBeNull();
    expect(Number(terms!.tiers ? (terms!.tiers as { rate: number }[])[0].rate : 0)).toBeCloseTo(0.25, 5);
  });

  it("prestation à compte d'auteur : AUCUN droit d'auteur (pas de RoyaltyTerms), modèle persisté", async () => {
    const res = await create({
      type: "prestation",
      economic_model: "compte_auteur",
      financial_terms: { service_cost: 450000, service_deposit: 150000, service_copies: 100, service_delivery: "sous 30 jours" },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    createdIds.push(id);
    expect(res.json().economicModel).toBe("compte_auteur");
    const terms = await prisma.royaltyTerms.findUnique({ where: { contractId: id } });
    expect(terms).toBeNull();
    // Les conditions de prestation vivent dans les termes financiers (JSON).
    const c = await prisma.contract.findUnique({ where: { id } });
    const ft = c!.financialTerms as Record<string, unknown>;
    expect(ft.service_cost).toBe(450000);
    expect(ft.service_delivery).toBe("sous 30 jours");
  });

  it("un taux absurde (> 100 %) est refusé quel que soit le modèle", async () => {
    const res = await create({ type: "prestation", economic_model: "autre", financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate: 1.5 }] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("royalty_rate_invalid");
  });

  it("le modèle économique est corrigeable sur un contrat existant (PATCH /terms)", async () => {
    // Contrat créé SANS modèle (null) → corrigé ensuite en « compte d'auteur ».
    const res = await create({ type: "edition", financial_terms: {} });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    createdIds.push(id);
    expect(res.json().economicModel ?? null).toBeNull();

    const patch = await app.inject({ method: "PATCH", url: `/api/v1/contracts/${id}/terms`, headers: { cookie }, payload: { economic_model: "compte_auteur" } });
    expect(patch.statusCode).toBe(200);
    const after = await prisma.contract.findUnique({ where: { id } });
    expect(after!.economicModel).toBe("compte_auteur");
  });

  it("les conditions de prestation sont corrigeables via PATCH /terms", async () => {
    const res = await create({ type: "prestation", economic_model: "compte_auteur", financial_terms: { service_cost: 100000, service_deposit: 20000 } });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    createdIds.push(id);

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${id}/terms`,
      headers: { cookie },
      payload: { service_cost: 450000, service_deposit: 150000, service_copies: 80, service_delivery: "sous 45 jours" },
    });
    expect(patch.statusCode).toBe(200);
    const after = await prisma.contract.findUnique({ where: { id } });
    const ft = after!.financialTerms as Record<string, unknown>;
    expect(ft.service_cost).toBe(450000);
    expect(ft.service_deposit).toBe(150000);
    expect(ft.service_copies).toBe(80);
    expect(ft.service_delivery).toBe("sous 45 jours");
  });
});
