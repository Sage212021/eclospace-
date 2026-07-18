import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import { buildFichePayload, formatFiche } from "../src/lib/sitePublisher.js";

// Fiche « site vitrine » (prête à publier). Le site étant sur-mesure (sans API),
// l'ERP prépare une fiche copiable et garde la trace de ce qui est publié.
// Règles testées : construction de la fiche (titre, auteur, genre, prix XAF,
// ISBN, résumé), endpoint d'aperçu, marquage « publié », permissions.

const rnd = Math.floor(Math.random() * 1e6);
const PWD = "SitePub123!";

async function login(app: FastifyInstance, username: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(res.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("fiche pour le site vitrine", () => {
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

    await createUserWithRole(`site_reader_${rnd}`, "CORRECTEUR", PWD);
    editorCookie = await login(app, `site_editor_${rnd}`, PWD);
    readerCookie = await login(app, `site_reader_${rnd}`, PWD);
  });

  afterAll(async () => {
    await app.close();
  });

  it("construit la fiche à partir des données de l'ouvrage", async () => {
    const payload = await buildFichePayload(manuscriptId);
    expect(payload.title).toBe(`Palmes d'or ${rnd}`);
    expect(payload.subtitle).toBe("Tome I : Les fables");
    expect(payload.author).toBe("Princesse SIKA-BEHA");
    expect(payload.genre).toBe(`Famille ${rnd}`);
    expect(payload.price).toBe(3000);
    expect(payload.currency).toBe("XAF");
    expect(payload.isbn).toMatch(/^978/);

    const fiche = formatFiche(payload);
    expect(fiche).toContain("Princesse SIKA-BEHA");
    expect(fiche).toContain(`Famille ${rnd}`);
    expect(fiche).toMatch(/3\s?000\s?XAF/);
    expect(fiche).toContain("Résumé :");
  });

  it("endpoint d'aperçu : renvoie la fiche prête à copier", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/site-publication`, headers: { cookie: editorCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fiche).toContain("Princesse SIKA-BEHA");
    expect(body.status).toBe("non_publie");
  });

  it("marquer comme publié : met à jour l'état et le lien", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscriptId}/site-publication`,
      headers: { cookie: editorCookie },
      payload: { published: true, url: "https://eclosion.cm/livre/palmes-dor" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("publie");
    expect(res.json().external_url).toBe("https://eclosion.cm/livre/palmes-dor");

    const row = await prisma.sitePublication.findUnique({ where: { manuscriptId } });
    expect(row?.status).toBe("publie");
    expect(row?.publishedAt).not.toBeNull();

    // Retrait : repasse en non publié.
    const off = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/site-publication`, headers: { cookie: editorCookie }, payload: { published: false } });
    expect(off.json().status).toBe("non_publie");
  });

  it("marquer est réservé à la saisie (consultation refusée)", async () => {
    const denied = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/site-publication`, headers: { cookie: readerCookie }, payload: { published: true } });
    expect(denied.statusCode).toBe(403);
  });
});
