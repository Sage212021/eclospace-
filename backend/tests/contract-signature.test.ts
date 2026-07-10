import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Phase B — signature « simple / interne » d'un contrat (décision opérateur du
// 10/07/2026). On vérifie : activation à la signature de la partie contractante,
// empreinte des termes, trace au journal, refus hors « attente de signature »,
// consentement obligatoire, et unicité par partie.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("signature simple d'un contrat (Lot B)", () => {
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
    const partner = await prisma.partner.create({
      data: { category: "auteur", firstName: "Awa", lastName: `Sign${Math.random().toString(36).slice(2, 7)}` },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { cookie },
      payload: {
        type: "edition",
        partner_id: partner.id,
        financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.1 }] },
      },
    });
    return { id: res.json().id as string, partner };
  }

  async function advanceToAwaitingSignature(id: string) {
    for (const status of ["legal_review", "direction_approval", "awaiting_signature"]) {
      await app.inject({ method: "PATCH", url: `/api/v1/contracts/${id}/status`, headers: { cookie }, payload: { status } });
    }
  }

  it("active le contrat quand la partie contractante signe, avec empreinte et trace", async () => {
    const { id, partner } = await newContract();
    await advanceToAwaitingSignature(id);

    const sign = await app.inject({
      method: "POST",
      url: `/api/v1/contracts/${id}/sign`,
      headers: { cookie },
      payload: { party: "author", signer_name: `${partner.firstName} ${partner.lastName}`, consent: true },
    });
    expect(sign.statusCode).toBe(200);
    const body = sign.json();
    expect(body.status).toBe("active");
    expect(body.signedAt).not.toBeNull();
    expect(body.signatures).toHaveLength(1);
    expect(body.signatures[0].party).toBe("author");
    expect(body.signatures[0].termsHash).toMatch(/^[0-9a-f]{64}$/);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "contract", entityId: id, action: "update" },
      orderBy: { occurredAt: "desc" },
    });
    expect(audit).not.toBeNull();
  });

  it("refuse la signature sans consentement explicite (400)", async () => {
    const { id, partner } = await newContract();
    await advanceToAwaitingSignature(id);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/contracts/${id}/sign`,
      headers: { cookie },
      payload: { party: "author", signer_name: `${partner.firstName} ${partner.lastName}`, consent: false },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("consent_required");
  });

  it("refuse la signature hors « attente de signature » (409)", async () => {
    const { id, partner } = await newContract(); // reste en « preparation »
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/contracts/${id}/sign`,
      headers: { cookie },
      payload: { party: "author", signer_name: `${partner.firstName} ${partner.lastName}`, consent: true },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("not_awaiting_signature");
  });

  it("la signature « maison » n'active pas seule, et une partie ne signe qu'une fois", async () => {
    const { id } = await newContract();
    await advanceToAwaitingSignature(id);

    const pub = await app.inject({
      method: "POST",
      url: `/api/v1/contracts/${id}/sign`,
      headers: { cookie },
      payload: { party: "publisher", signer_name: "Éclosion Édition", consent: true },
    });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().status).toBe("awaiting_signature");

    // Deuxième signature « maison » refusée.
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/contracts/${id}/sign`,
      headers: { cookie },
      payload: { party: "publisher", signer_name: "Éclosion Édition", consent: true },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("already_signed");

    // La partie contractante (auteur) signe ensuite → activation.
    const author = await app.inject({
      method: "POST",
      url: `/api/v1/contracts/${id}/sign`,
      headers: { cookie },
      payload: { party: "author", signer_name: "Awa Auteur", consent: true },
    });
    expect(author.statusCode).toBe(200);
    expect(author.json().status).toBe("active");
    expect(author.json().signatures).toHaveLength(2);
  });
});
