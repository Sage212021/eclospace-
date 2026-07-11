import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Compte d'auteur (Phase B) : devis de prestation → signature (interne ou en
// ligne) → facture. On vérifie totaux, parcours de signature (③ en ligne + ①
// interne), génération de la facture (client-auteur, aucun droit généré,
// numérotation), et les refus (facture avant acceptation, consentement).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("devis de prestation éditoriale (compte d'auteur)", () => {
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

  async function newAuthor() {
    return prisma.partner.create({
      data: { category: "auteur", firstName: "Awa", lastName: `Devis${Math.random().toString(36).slice(2, 7)}`, email: "awa@example.com" },
    });
  }

  async function createQuote(partnerId: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/editorial-quotes",
      headers: { cookie },
      payload: {
        partner_id: partnerId,
        lines: [
          { description: "Relecture", quantity: 1, unit_price: 50000, tax_rate: 0 },
          { description: "Proposition de couverture", quantity: 1, unit_price: 75000, tax_rate: 0 },
        ],
      },
    });
    return res;
  }

  it("crée un devis avec totaux et mention d'exclusion par défaut", async () => {
    const author = await newAuthor();
    const res = await createQuote(author.id);
    expect(res.statusCode).toBe(201);
    const q = res.json();
    expect(q.status).toBe("draft");
    expect(Number(q.totalHt)).toBe(125000);
    expect(Number(q.totalTtc)).toBe(125000);
    expect(q.quoteNumber).toMatch(/^DE-\d{4}-\d{4}$/);
    expect(q.exclusionsNote).toContain("hors frais d'impression");
    expect(q.lines).toHaveLength(2);
  });

  it("signature en ligne (③) : envoi → lien public → signature → facture sans droits", async () => {
    const author = await newAuthor();
    const created = (await createQuote(author.id)).json();

    // Envoi pour signature : jeton généré.
    const send = await app.inject({ method: "POST", url: `/api/v1/editorial-quotes/${created.id}/send`, headers: { cookie }, payload: {} });
    expect(send.statusCode).toBe(200);
    const token = send.json().sign_path.split("/").pop();
    expect(token).toBeTruthy();

    // Consultation publique du devis via le jeton (sans authentification).
    const pub = await app.inject({ method: "GET", url: `/api/v1/public/editorial-quotes/${token}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().quote_number).toBe(created.quoteNumber);

    // Signature en ligne par l'auteur.
    const sign = await app.inject({
      method: "POST",
      url: `/api/v1/public/editorial-quotes/${token}/sign`,
      payload: { signer_name: `${author.firstName} ${author.lastName}`, consent: true },
    });
    expect(sign.statusCode).toBe(200);

    const afterSign = (await app.inject({ method: "GET", url: `/api/v1/editorial-quotes/${created.id}`, headers: { cookie } })).json();
    expect(afterSign.status).toBe("accepted");
    expect(afterSign.acceptanceMethod).toBe("online_link");
    expect(afterSign.termsHash).toMatch(/^[0-9a-f]{64}$/);

    // Le lien est à usage unique : re-signer échoue (jeton consommé).
    const reuse = await app.inject({
      method: "POST",
      url: `/api/v1/public/editorial-quotes/${token}/sign`,
      payload: { signer_name: "Autre Personne", consent: true },
    });
    expect(reuse.statusCode).toBe(404);

    // Génération de la facture.
    const inv = await app.inject({ method: "POST", url: `/api/v1/editorial-quotes/${created.id}/invoice`, headers: { cookie } });
    expect(inv.statusCode).toBe(201);
    const invoice = inv.json();
    expect(invoice.invoiceNumber).toMatch(/^FA-\d{4}-\d{5}$/);
    expect(Number(invoice.totalTtc)).toBe(125000);

    // Le client de la facture est bien l'auteur (catégorie « auteur », lié au partenaire).
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: invoice.customerId } });
    expect(customer.category).toBe("auteur");
    expect(customer.partnerId).toBe(author.id);

    // Aucun droit d'auteur généré par une prestation.
    const royalties = await prisma.royaltyEntry.count({ where: { sourceType: "editorial_quote" } });
    expect(royalties).toBe(0);

    // Le devis est marqué « facturé » et relié à la facture.
    const quoteAfter = await prisma.editorialQuote.findUniqueOrThrow({ where: { id: created.id } });
    expect(quoteAfter.status).toBe("invoiced");
    expect(quoteAfter.invoiceId).toBe(invoice.id);
  });

  it("acceptation interne (①) par un agent verrouille le devis", async () => {
    const author = await newAuthor();
    const created = (await createQuote(author.id)).json();
    const accept = await app.inject({
      method: "POST",
      url: `/api/v1/editorial-quotes/${created.id}/accept`,
      headers: { cookie },
      payload: { method: "internal", signer_name: `${author.firstName} ${author.lastName}`, consent: true },
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().status).toBe("accepted");
    expect(accept.json().acceptanceMethod).toBe("internal");
  });

  it("refuse la facture avant acceptation du devis (409)", async () => {
    const author = await newAuthor();
    const created = (await createQuote(author.id)).json();
    const inv = await app.inject({ method: "POST", url: `/api/v1/editorial-quotes/${created.id}/invoice`, headers: { cookie } });
    expect(inv.statusCode).toBe(409);
    expect(inv.json().code).toBe("quote_not_accepted");
  });

  it("refuse l'acceptation sans consentement (400)", async () => {
    const author = await newAuthor();
    const created = (await createQuote(author.id)).json();
    const accept = await app.inject({
      method: "POST",
      url: `/api/v1/editorial-quotes/${created.id}/accept`,
      headers: { cookie },
      payload: { method: "internal", signer_name: "Awa", consent: false },
    });
    expect(accept.statusCode).toBe(400);
    expect(accept.json().code).toBe("consent_required");
  });
});
