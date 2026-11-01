import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Contrat À COMPTE D'AUTEUR — fidélité des informations contractuelles.
// Objectif opérateur : 100 % de fidélité entre la fiche, l'aperçu, le document
// généré et la version transférée. Comme ces quatre vues sont désormais
// alimentées par les MÊMES données enregistrées (`financial_terms`), ce test
// garantit que ces données (frais éditoriaux, prix de vente, date limite de
// publication, intervenants…) sont bien stockées et NE DISPARAISSENT PAS, et que
// l'enregistrement FUSIONNE (ne remplace pas) — donc aucune information ne se
// perd au fil des modifications ou du transfert.

const rnd = () => Math.random().toString(36).slice(2, 8);
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("contrat à compte d'auteur — fidélité des termes (source unique)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let partnerId: string;
  const createdIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));
    const partner = await prisma.partner.create({ data: { firstName: "Paul", lastName: `Avom-${rnd()}`, category: "auteur" } });
    partnerId = partner.id;
  });

  afterAll(async () => {
    await prisma.contract.deleteMany({ where: { partnerId } });
    await prisma.partner.delete({ where: { id: partnerId } }).catch(() => {});
    await app.close();
  });

  const ft = (id: string) => prisma.contract.findUniqueOrThrow({ where: { id } }).then((c) => (c.financialTerms ?? {}) as Record<string, unknown>);

  it("crée un contrat à compte d'auteur et conserve frais + prix + date limite de publication", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/contracts", headers: { cookie },
      payload: {
        type: "edition", economic_model: "compte_auteur", partner_id: partnerId,
        financial_terms: {
          editorial_fees: 100000,
          sale_price_min: 6000,
          print_copies: 200,
          logo_pct: 10,
          distribution_pct: 25,
          duration_years: 5,
          territory: "Cameroun",
          publication_date: "05/10/2026",
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    createdIds.push(id);

    const f = await ft(id);
    expect(f.editorial_fees).toBe(100000);
    expect(f.sale_price_min).toBe(6000);
    expect(f.publication_date).toBe("05/10/2026");
    expect(f.territory).toBe("Cameroun");
  });

  it("la modification des termes FUSIONNE sans rien perdre (frais, prix, date)", async () => {
    // Contrat initial avec les frais seulement.
    const res = await app.inject({
      method: "POST", url: "/api/v1/contracts", headers: { cookie },
      payload: {
        type: "edition", economic_model: "compte_auteur", partner_id: partnerId,
        financial_terms: { editorial_fees: 100000, territory: "Cameroun" },
      },
    });
    const id = res.json().id;
    createdIds.push(id);

    // Modification n°1 : on renseigne SEULEMENT le prix de vente mini.
    const r1 = await app.inject({
      method: "PATCH", url: `/api/v1/contracts/${id}/terms`, headers: { cookie },
      payload: { type: "edition", economic_model: "compte_auteur", sale_price_min: 6000 },
    });
    expect(r1.statusCode).toBe(200);
    let f = await ft(id);
    // Les frais saisis AVANT ne doivent PAS disparaître (fusion, pas remplacement).
    expect(f.editorial_fees).toBe(100000);
    expect(f.sale_price_min).toBe(6000);

    // Modification n°2 : on ajoute la date limite de publication (article 3).
    const r2 = await app.inject({
      method: "PATCH", url: `/api/v1/contracts/${id}/terms`, headers: { cookie },
      payload: { type: "edition", economic_model: "compte_auteur", publication_date: "05/10/2026" },
    });
    expect(r2.statusCode).toBe(200);
    f = await ft(id);
    // Tout est conservé : frais, prix ET date.
    expect(f.editorial_fees).toBe(100000);
    expect(f.sale_price_min).toBe(6000);
    expect(f.publication_date).toBe("05/10/2026");
    expect(f.territory).toBe("Cameroun");
  });
});
