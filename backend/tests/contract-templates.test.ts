import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Bibliothèque de modèles de contrat (§9) : texte par défaut d'un article,
// éditable sans code. Écriture réservée à l'autorité « contrats (validation) » ;
// un body vide revient au texte standard (ligne supprimée).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("modèles de contrat éditables (§9)", () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(login.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    await prisma.contractClauseTemplate.deleteMany({ where: { templateKey: { in: ["edition", "service"] }, articleNumber: { in: [3, 99] } } });
    await app.close();
  });

  it("définit, relit puis efface le texte par défaut d'un article", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/contract-templates",
      headers: { cookie },
      payload: { template_key: "service", article_number: 3, body: "Le coût total est de {{cout}} ; acompte {{acompte}}." },
    });
    expect(put.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/api/v1/contract-templates", headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const row = (list.json() as { template_key: string; article_number: number; body: string }[]).find((r) => r.template_key === "service" && r.article_number === 3);
    expect(row).toBeTruthy();
    expect(row!.body).toContain("{{cout}}");

    // body vide → retour au texte standard (ligne supprimée).
    const clear = await app.inject({ method: "PUT", url: "/api/v1/contract-templates", headers: { cookie }, payload: { template_key: "service", article_number: 3, body: "   " } });
    expect(clear.statusCode).toBe(200);
    const after = await prisma.contractClauseTemplate.findMany({ where: { templateKey: "service", articleNumber: 3 } });
    expect(after.length).toBe(0);
  });

  it("accepte la clef de modèle « auteur » (contrat à compte d'auteur)", async () => {
    const put = await app.inject({ method: "PUT", url: "/api/v1/contract-templates", headers: { cookie }, payload: { template_key: "auteur", article_number: 6, body: "Rémunération : {{pct_logo}} % logo ; {{pct_distribution}} % distribution." } });
    expect(put.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/api/v1/contract-templates", headers: { cookie } });
    const row = (list.json() as { template_key: string; article_number: number }[]).find((r) => r.template_key === "auteur" && r.article_number === 6);
    expect(row).toBeTruthy();
    await app.inject({ method: "PUT", url: "/api/v1/contract-templates", headers: { cookie }, payload: { template_key: "auteur", article_number: 6, body: "" } });
  });

  it("refuse une clef de modèle ou un numéro d'article invalide", async () => {
    const badKey = await app.inject({ method: "PUT", url: "/api/v1/contract-templates", headers: { cookie }, payload: { template_key: "xxx", article_number: 1, body: "x" } });
    expect(badKey.statusCode).toBe(400);
    const badNum = await app.inject({ method: "PUT", url: "/api/v1/contract-templates", headers: { cookie }, payload: { template_key: "edition", article_number: 99, body: "x" } });
    expect(badNum.statusCode).toBe(400);
  });
});
