import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Identité de l'auteur collectée à l'enregistrement du manuscrit et reprise sur
// le contrat ; durée du contrat variable (terme du contrat d'édition).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const login = async (app: FastifyInstance, u: string, p: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

describe("identité auteur & durée du contrat", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let genreId: string;

  beforeAll(async () => {
    app = await buildApp();
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    adminCookie = await login(app, "admin", ADMIN_PASSWORD);
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("stocke les renseignements d'identité de l'auteur saisis à l'enregistrement", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: {
        title: "Œuvre test identité",
        genre_id: genreId,
        language: "fr",
        owner_id: adminId,
        author: {
          first_name: "Protais",
          last_name: "Ayangma",
          address: "BP 1234 Yaoundé",
          nationality: "Camerounaise",
          profession: "Enseignant",
          id_number: "10203040",
          id_issued_date: "2019-05-10T00:00:00.000Z",
          id_issued_place: "Yaoundé",
          birth_date: "1980-01-15T00:00:00.000Z",
          birth_place: "Douala",
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const manuscriptId = res.json().id as string;
    const contributor = await prisma.workContributor.findFirstOrThrow({ where: { manuscriptId, role: "author" }, include: { partner: true } });
    expect(contributor.partner.address).toBe("BP 1234 Yaoundé");
    expect(contributor.partner.idNumber).toBe("10203040");
    expect(contributor.partner.nationality).toBe("Camerounaise");
    expect(contributor.partner.birthPlace).toBe("Douala");
    expect(contributor.partner.idIssuedDate?.toISOString().slice(0, 10)).toBe("2019-05-10");
  });

  it("conserve la durée saisie sur le contrat (terme variable)", async () => {
    const partner = await prisma.partner.create({ data: { category: "auteur", firstName: "Test", lastName: "Durée" } });
    const manuscript = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: { title: "Œuvre durée", genre_id: genreId, language: "fr", owner_id: adminId, author: { author_id: partner.id } },
    });
    const manuscriptId = manuscript.json().id as string;

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { cookie: adminCookie },
      payload: {
        type: "edition",
        manuscript_id: manuscriptId,
        partner_id: partner.id,
        duration_months: 60,
        financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.12 }], advance_amount: 0, payment_schedule: "semestriel" },
      },
    });
    expect(created.statusCode).toBe(201);
    const contractId = created.json().id as string;

    const detail = await app.inject({ method: "GET", url: `/api/v1/contracts/${contractId}`, headers: { cookie: adminCookie } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().durationMonths).toBe(60);
  });

  it("complète l'identité de l'auteur après coup (PATCH partenaire)", async () => {
    const partner = await prisma.partner.create({ data: { category: "auteur", firstName: "Ancien", lastName: "Auteur" } });
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/partners/${partner.id}`,
      headers: { cookie: adminCookie },
      payload: { id_number: "55667788", nationality: "Camerounaise", birth_date: "1975-03-03T00:00:00.000Z" },
    });
    expect(res.statusCode).toBe(200);
    const reloaded = await prisma.partner.findUniqueOrThrow({ where: { id: partner.id } });
    expect(reloaded.idNumber).toBe("55667788");
    expect(reloaded.birthDate?.toISOString().slice(0, 10)).toBe("1975-03-03");
  });
});
