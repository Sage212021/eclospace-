import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import { buildProductPayload, publishToSite } from "../src/lib/sitePublisher.js";

// Publication d'un ouvrage sur le site vitrine. Règles testées : construction
// du produit à partir de l'ERP (nom, auteur, genre→catégorie, prix XAF, ISBN,
// résumé), aperçu sans configuration (aucun envoi réel), permissions.

const rnd = Math.floor(Math.random() * 1e6);
const PWD = "SitePub123!";

async function login(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("publication sur le site vitrine", () => {
  let app: FastifyInstance;
  let manuscriptId: string;
  let editorCookie: string;
  let readerCookie: string;

  beforeAll(async () => {
    app = await buildApp();

    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "MISE_EN_PAGE" }, select: { id: true } });
    const genre = await prisma.genre.create({ data: { code: `SITE_G_${rnd}`, label: `Famille ${rnd}` } });
    const partner = await prisma.partner.create({ data: { firstName: "Princesse", lastName: `Sika ${rnd}`, penName: "Princesse SIKA-BEHA" } });
    const editor = await createUserWithRole(`site_editor_${rnd}`, "ADMIN_GENERAL", PWD);

    const m = await prisma.manuscript.create({
      data: {
        title: `Palmes d'or ${rnd}`,
        subtitle: "Tome I : Les fables",
        language: "fr",
        manuscriptNumber: `MS-SITE-${rnd}`,
        statusId: status.id,
        genreId: genre.id,
        ownerId: editor.id,
        receivedAt: new Date(),
        summary: "Nos histoires africaines, un recueil de fables.",
      },
    });
    manuscriptId = m.id;
    await prisma.workContributor.create({ data: { manuscriptId: m.id, partnerId: partner.id, role: "author", displayOrder: 0 } });
    await prisma.workMetadata.create({ data: { manuscriptId: m.id, priceByCountry: { CM: 3000 } } });
    await prisma.isbn.create({ data: { isbn13: `978${rnd}${Math.floor(Math.random() * 900 + 100)}`.slice(0, 13), format: "print", manuscriptId: m.id } });

    // Maquettiste = utilisateur avec manuscripts:saisie (ici ADMIN_GENERAL, déjà créé).
    await createUserWithRole(`site_reader_${rnd}`, "CORRECTEUR", PWD);
    editorCookie = await login(app, `site_editor_${rnd}`, PWD);
    readerCookie = await login(app, `site_reader_${rnd}`, PWD);
  });

  afterAll(async () => {
    await app.close();
  });

  it("construit le produit à partir des données de l'ouvrage", async () => {
    const payload = await buildProductPayload(manuscriptId);
    expect(payload.name).toBe(`Palmes d'or ${rnd} — Tome I : Les fables`);
    expect(payload.author).toBe("Princesse SIKA-BEHA");
    expect(payload.category).toBe(`Famille ${rnd}`); // genre
    expect(payload.price).toBe(3000); // XAF depuis priceByCountry
    expect(payload.currency).toBe("XAF");
    expect(payload.description).toContain("fables");
    expect(payload.sku).toMatch(/^978/); // ISBN
  });

  it("sans configuration du site : aperçu enregistré, aucun envoi réel", async () => {
    const result = await publishToSite(manuscriptId, { id: "test" });
    expect(result.published).toBe(false);
    if (!result.published) expect(result.reason).toBe("not_configured");
    const row = await prisma.sitePublication.findUnique({ where: { manuscriptId } });
    expect(row).not.toBeNull();
    expect(row?.status).toBe("non_publie"); // pas « publié » puisque non envoyé
    expect(row?.lastPayload).not.toBeNull(); // l'aperçu est mémorisé
  });

  it("endpoint d'aperçu : accessible en consultation, signale l'état non configuré", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/site-publication`, headers: { cookie: editorCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(false);
    expect(body.payload.category).toBe(`Famille ${rnd}`);
  });

  it("publier est réservé à la saisie (consultation refusée)", async () => {
    const denied = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/site-publication`, headers: { cookie: readerCookie } });
    expect(denied.statusCode).toBe(403);

    const ok = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/site-publication`, headers: { cookie: editorCookie } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().ok).toBe(false); // non configuré : aperçu, pas d'envoi
    expect(ok.json().reason).toBe("not_configured");
  });
});
