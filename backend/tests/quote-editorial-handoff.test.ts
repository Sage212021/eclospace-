import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Circuit devis → Éditorial → client → facture : la Finance établit le devis et
// le transmet à l'Éditorial, qui l'envoie au client et remonte la validation ;
// la facture n'est possible qu'après validation. Devis ≠ facture.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const PWD = "Quote123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
const login = async (app: FastifyInstance, u: string, p: string) => {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
};

describe("circuit devis → éditorial → facture", () => {
  let app: FastifyInstance;
  let financeCookie: string; // admin = tous droits (finance)
  let editorialCookie: string; // manuscripts:saisie
  let plainCookie: string; // ni finance ni manuscrits

  beforeAll(async () => {
    app = await buildApp();
    financeCookie = await login(app, "admin", ADMIN_PASSWORD);
    const ed = `edit_${rnd()}`;
    await createUserWithRole(ed, "ASSISTANT_EDITORIAL", PWD); // manuscripts:saisie
    editorialCookie = await login(app, ed, PWD);
    const pl = `corr_${rnd()}`;
    await createUserWithRole(pl, "CORRECTEUR", PWD);
    plainCookie = await login(app, pl, PWD);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function newQuote() {
    const author = await prisma.partner.create({ data: { category: "auteur", firstName: "Awa", lastName: `Q${rnd()}`, email: "awa@example.com" } });
    const res = await app.inject({ method: "POST", url: "/api/v1/editorial-quotes", headers: { cookie: financeCookie }, payload: { partner_id: author.id, lines: [{ description: "Relecture", quantity: 1, unit_price: 50000, tax_rate: 0 }] } });
    return res.json().id as string;
  }

  it("Finance transmet à l'Éditorial ; le devis apparaît dans la vue éditoriale", async () => {
    const id = await newQuote();
    // Avant transmission : absent de la vue éditoriale.
    const before = await app.inject({ method: "GET", url: "/api/v1/editorial/quotes", headers: { cookie: editorialCookie } });
    expect((before.json() as { id: string }[]).some((q) => q.id === id)).toBe(false);

    const hand = await app.inject({ method: "POST", url: `/api/v1/editorial-quotes/${id}/hand-to-editorial`, headers: { cookie: financeCookie } });
    expect(hand.statusCode).toBe(200);

    const after = await app.inject({ method: "GET", url: "/api/v1/editorial/quotes", headers: { cookie: editorialCookie } });
    expect((after.json() as { id: string }[]).some((q) => q.id === id)).toBe(true);
  });

  it("l'Éditorial envoie au client puis remonte la validation ; la facture suit côté Finance", async () => {
    const id = await newQuote();
    await app.inject({ method: "POST", url: `/api/v1/editorial-quotes/${id}/hand-to-editorial`, headers: { cookie: financeCookie } });

    // La facture est refusée tant que le client n'a pas validé.
    const tooEarly = await app.inject({ method: "POST", url: `/api/v1/editorial-quotes/${id}/invoice`, headers: { cookie: financeCookie } });
    expect(tooEarly.statusCode).toBe(409);

    // L'éditorial envoie au client.
    const send = await app.inject({ method: "POST", url: `/api/v1/editorial-quotes/${id}/send`, headers: { cookie: editorialCookie } });
    expect(send.statusCode).toBe(200);

    // L'éditorial remonte la validation du client.
    const accept = await app.inject({ method: "POST", url: `/api/v1/editorial-quotes/${id}/accept`, headers: { cookie: editorialCookie }, payload: { consent: true, signer_name: "Awa Cliente", method: "internal" } });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().status).toBe("accepted");

    // La Finance établit la facture (devis ≠ facture).
    const invoice = await app.inject({ method: "POST", url: `/api/v1/editorial-quotes/${id}/invoice`, headers: { cookie: financeCookie } });
    expect(invoice.statusCode).toBe(201);
  });

  it("refuse la vue éditoriale sans droit (403)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/editorial/quotes", headers: { cookie: plainCookie } });
    expect(res.statusCode).toBe(403);
  });
});
