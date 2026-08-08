import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Tableau de bord des contrats (refonte CLM, phase 1) : compteurs par statut,
// échéances/retards, restauration d'un contrat supprimé, date de validation.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("tableau de bord & restauration des contrats", () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function newContract() {
    const partner = await prisma.partner.create({ data: { category: "auteur", firstName: "Dash", lastName: `Bord${rnd()}` } });
    const res = await app.inject({
      method: "POST", url: "/api/v1/contracts", headers: { cookie },
      payload: { type: "edition", partner_id: partner.id, financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.1 }] } },
    });
    return res.json().id as string;
  }

  it("compte les contrats par statut et pose la date de validation à l'entrée en signature", async () => {
    const id = await newContract();
    for (const status of ["legal_review", "direction_approval", "awaiting_signature"]) {
      await app.inject({ method: "PATCH", url: `/api/v1/contracts/${id}/status`, headers: { cookie }, payload: { status } });
    }
    const row = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect(row.validatedAt).not.toBeNull();

    const dash = (await app.inject({ method: "GET", url: "/api/v1/contracts/dashboard", headers: { cookie } })).json();
    expect(dash.by_status).toHaveProperty("awaiting_signature");
    expect(dash.by_status.awaiting_signature).toBeGreaterThanOrEqual(1);
    expect(typeof dash.total).toBe("number");
    expect(Array.isArray(dash.expiring)).toBe(true);
  });

  it("signale un contrat actif arrivant à échéance (retard)", async () => {
    const id = await newContract();
    // Contrat actif, effet il y a 13 mois, durée 12 mois → échu.
    const past = new Date();
    past.setMonth(past.getMonth() - 13);
    await prisma.contract.update({ where: { id }, data: { status: "active", effectiveAt: past, durationMonths: 12 } });

    const dash = (await app.inject({ method: "GET", url: "/api/v1/contracts/dashboard", headers: { cookie } })).json();
    const row = dash.expiring.find((e: { id: string }) => e.id === id);
    expect(row).toBeTruthy();
    expect(row.overdue).toBe(true);
  });

  it("restaure un contrat supprimé", async () => {
    const id = await newContract();
    await app.inject({ method: "DELETE", url: `/api/v1/contracts/${id}`, headers: { cookie } });
    expect((await app.inject({ method: "GET", url: `/api/v1/contracts/${id}`, headers: { cookie } })).statusCode).toBe(404);

    const dash = (await app.inject({ method: "GET", url: "/api/v1/contracts/dashboard", headers: { cookie } })).json();
    expect(dash.deleted.some((d: { id: string }) => d.id === id)).toBe(true);

    const restore = await app.inject({ method: "POST", url: `/api/v1/contracts/${id}/restore`, headers: { cookie } });
    expect(restore.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/v1/contracts/${id}`, headers: { cookie } })).statusCode).toBe(200);
  });
});
