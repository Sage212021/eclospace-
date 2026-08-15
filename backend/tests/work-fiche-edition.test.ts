import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Lot 2 fiche ouvrage : type d'édition (§4), prix (public / pro / éditeur),
// coût de production unitaire et volet scolaire (§3) sont saisis et persistés
// dans la fiche de métadonnées de l'ouvrage.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("fiche ouvrage — type d'édition & volet commercial (Lot 2)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let manuscriptId: string;

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
    const created = await app.inject({
      method: "POST", url: "/api/v1/manuscripts", headers: { cookie },
      payload: { title: `Fiche Édition ${Math.random().toString(36).slice(2, 7)}`, genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "A", last_name: "B" } },
    });
    manuscriptId = created.json().id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("enregistre le type d'édition, les prix, le coût et le volet scolaire", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/api/v1/manuscripts/${manuscriptId}/metadata`, headers: { cookie },
      payload: {
        edition_type: "compte_editeur",
        price_public: 5000, price_pro: 3500, price_editeur: 2800, unit_production_cost: 1200,
        commercialization_status: "disponible",
        is_school_book: true, school_level: "6e", school_subject: "Français", school_year: "2026-2027",
      },
    });
    expect(res.statusCode).toBe(200);

    const meta = await prisma.workMetadata.findUniqueOrThrow({ where: { manuscriptId } });
    expect(meta.editionType).toBe("compte_editeur");
    expect(Number(meta.pricePublic)).toBe(5000);
    expect(Number(meta.pricePro)).toBe(3500);
    expect(Number(meta.priceEditeur)).toBe(2800);
    expect(Number(meta.unitProductionCost)).toBe(1200);
    expect(meta.commercializationStatus).toBe("disponible");
    expect(meta.isSchoolBook).toBe(true);
    expect(meta.schoolLevel).toBe("6e");
    expect(meta.schoolSubject).toBe("Français");
  });

  it("renvoie ces champs à la lecture de la fiche", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/metadata`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.editionType).toBe("compte_editeur");
    expect(Number(body.pricePublic)).toBe(5000);
    expect(body.isSchoolBook).toBe(true);
  });

  it("permet d'effacer un champ (null) et de modifier le type d'édition", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/api/v1/manuscripts/${manuscriptId}/metadata`, headers: { cookie },
      payload: { edition_type: "coedition", price_pro: null, is_school_book: false },
    });
    expect(res.statusCode).toBe(200);
    const meta = await prisma.workMetadata.findUniqueOrThrow({ where: { manuscriptId } });
    expect(meta.editionType).toBe("coedition");
    expect(meta.pricePro).toBeNull();
    expect(meta.isSchoolBook).toBe(false);
    // Les autres champs restent inchangés (undefined = pas touché).
    expect(Number(meta.pricePublic)).toBe(5000);
  });

  it("refuse un type d'édition invalide (400)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/api/v1/manuscripts/${manuscriptId}/metadata`, headers: { cookie },
      payload: { edition_type: "compte_martien" },
    });
    expect(res.statusCode).toBe(400);
  });
});
