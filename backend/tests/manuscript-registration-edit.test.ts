import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Correction de la fiche d'enregistrement après coup (décision 07/08/2026) :
// modifiable TANT QUE le contrat n'est pas signé, motif obligatoire, tracé.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("fiche manuscrit modifiable jusqu'au contrat signé", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let genreId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function newManuscript(title: string) {
    const r = await app.inject({
      method: "POST", url: "/api/v1/manuscripts", headers: { cookie },
      payload: { title, genre_id: genreId, language: "fr", owner_id: adminId, evaluation_fee_choice: "non_defini", author: { first_name: "Jean", last_name: "Dupon" } },
    });
    expect(r.statusCode).toBe(201);
    return r.json();
  }

  it("corrige l'ouvrage et l'identité de l'auteur (motif requis, tracé)", async () => {
    const m = await newManuscript("Titre erroné");
    const res = await app.inject({
      method: "PATCH", url: `/api/v1/manuscripts/${m.id}/registration`, headers: { cookie },
      payload: { modification_reason: "Nom de l'auteur et titre mal saisis.", title: "Titre corrigé", author: { first_name: "Jean", last_name: "Dupont", niu: "P0123456789" } },
    });
    expect(res.statusCode).toBe(200);

    const detail = (await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}`, headers: { cookie } })).json();
    expect(detail.title).toBe("Titre corrigé");
    const author = detail.workContributors[0].partner;
    expect(author.lastName).toBe("Dupont");
    expect(author.niu).toBe("P0123456789");

    const log = await prisma.auditLog.findFirst({ where: { entityType: "manuscript", entityId: m.id, action: "update" }, });
    expect(log).not.toBeNull();
  });

  it("refuse sans motif (400)", async () => {
    const m = await newManuscript("Sans motif");
    const res = await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${m.id}/registration`, headers: { cookie }, payload: { title: "X" } });
    expect(res.statusCode).toBe(400);
  });

  it("verrouille la fiche dès qu'un contrat est signé (409)", async () => {
    const m = await newManuscript("Bientôt sous contrat");
    const partnerId = (await prisma.workContributor.findFirstOrThrow({ where: { manuscriptId: m.id, role: "author" } })).partnerId;
    await prisma.contract.create({
      data: { contractNumber: `CT-TEST-${Date.now()}`, manuscriptId: m.id, partnerId, type: "edition", status: "active", signedAt: new Date(), financialTerms: {}, createdBy: adminId },
    });

    const res = await app.inject({
      method: "PATCH", url: `/api/v1/manuscripts/${m.id}/registration`, headers: { cookie },
      payload: { modification_reason: "Tentative après signature.", title: "Ne doit pas passer" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("registration_locked");

    // Le GET signale aussi le verrou pour l'UI.
    const detail = (await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}`, headers: { cookie } })).json();
    expect(detail.registrationLocked).toBe(true);
  });
});
