import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Fiche d'enregistrement enrichie : identité complète de l'auteur, choix des
// frais de dépôt d'évaluation (demande auto à la Finance si « à payer »), délai
// de réponse à l'auteur.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const login = async (app: FastifyInstance, u: string, p: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

describe("fiche d'enregistrement enrichie", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let genreId: string;

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login(app, "admin", ADMIN_PASSWORD);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("enregistre l'identité complète de l'auteur + délai de réponse", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie },
      payload: {
        title: "Œuvre fiche enrichie",
        genre_id: genreId,
        language: "fr",
        owner_id: adminId,
        evaluation_fee_choice: "sans_frais",
        author_response_delay_days: 60,
        author: {
          first_name: "Awa", last_name: "Complète",
          id_type: "Passeport", id_number: "P123456", niu: "NIU-999",
          country: "Cameroun", city: "Douala", quartier: "Bonapriso", postal_box: "BP 456",
          whatsapp: "+237600000000", other_contact: "Frère : +237611111111",
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const m = await prisma.manuscript.findUniqueOrThrow({ where: { id: res.json().id }, include: { workContributors: { include: { partner: true } } } });
    expect(m.authorResponseDelayDays).toBe(60);
    expect(m.evaluationFeeChoice).toBe("sans_frais");
    const p = m.workContributors[0].partner;
    expect(p.idType).toBe("Passeport");
    expect(p.niu).toBe("NIU-999");
    expect(p.city).toBe("Douala");
    expect(p.quartier).toBe("Bonapriso");
    expect(p.whatsapp).toBe("+237600000000");
    expect(p.otherContact).toContain("Frère");
  });

  it("initie automatiquement une demande de frais de dépôt si « à payer » (traçabilité)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie },
      payload: {
        title: "Œuvre frais à payer",
        genre_id: genreId,
        language: "fr",
        owner_id: adminId,
        evaluation_fee_choice: "a_payer",
        author: { first_name: "Ben", last_name: "Payeur" },
      },
    });
    expect(res.statusCode).toBe(201);
    const reqs = await prisma.manuscriptFinanceRequest.findMany({ where: { manuscriptId: res.json().id } });
    expect(reqs.length).toBe(1);
    expect(reqs[0].type).toBe("frais_depot");
    expect(reqs[0].requestedBy).toBe(adminId); // traçabilité : qui a initié
  });

  it("n'initie aucune demande si « sans frais »", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie },
      payload: { title: "Œuvre sans frais", genre_id: genreId, language: "fr", owner_id: adminId, evaluation_fee_choice: "sans_frais", author: { first_name: "Sans", last_name: "Frais" } },
    });
    const reqs = await prisma.manuscriptFinanceRequest.findMany({ where: { manuscriptId: res.json().id } });
    expect(reqs.length).toBe(0);
  });
});
