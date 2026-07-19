import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import { buildFichePayload, formatFiche, optimizedCoverForSite } from "../src/lib/sitePublisher.js";
import { optimizeImage } from "../src/lib/imageOptimize.js";
import { storeFile } from "../src/lib/storage.js";
import { Jimp } from "jimp";

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
    // Couverture associée : structure présente, indisponible ici (aucune déposée).
    expect(body.cover).toBeDefined();
    expect(body.cover.available).toBe(false);
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

// Couverture « prête pour le web » : la couverture déposée est en qualité
// impression (lourde) ; le téléchargement pour le site doit renvoyer une image
// LÉGÈRE, en JPG de très bonne qualité, réduite (jamais agrandie).
// Image « photographique » (dégradé) : contrairement à un aplat de couleur,
// elle a un poids réaliste — le JPG optimisé (réduit) est alors plus léger.
async function gradientPng(w: number, h: number): Promise<Buffer> {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = (x * 255 / w) | 0;
      data[i + 1] = (y * 255 / h) | 0;
      data[i + 2] = ((x + y) * 255 / (w + h)) | 0;
      data[i + 3] = 255;
    }
  }
  return new Jimp({ width: w, height: h, data }).getBuffer("image/png");
}

describe("couverture optimisée pour le site", () => {
  it("réduit une grande image et produit un JPG plus léger", async () => {
    const big = await gradientPng(2400, 3600);
    const out = await optimizeImage(big, { maxLongSide: 1600, quality: 86, format: "jpeg" });
    expect(out.mime).toBe("image/jpeg");
    expect(out.ext).toBe("jpg");
    expect(out.buffer.length).toBeLessThan(big.length); // plus léger que l'original
    // Dimensions plafonnées à 1600 px sur le grand côté.
    const decoded = await Jimp.read(out.buffer);
    expect(Math.max(decoded.width, decoded.height)).toBeLessThanOrEqual(1600);
  });

  it("n'agrandit jamais une petite image", async () => {
    const small = await new Jimp({ width: 400, height: 600, color: 0x2a5d84ff }).getBuffer("image/png");
    const out = await optimizeImage(small, { maxLongSide: 1600 });
    const decoded = await Jimp.read(out.buffer);
    expect(Math.max(decoded.width, decoded.height)).toBe(600);
  });

  it("cale dans la boîte portrait du site sans couper ni déformer", async () => {
    // Couverture 2:3 déjà proche du format du site → doit tenir dans 1080×1600
    // en gardant exactement ses proportions (aucune coupe, aucune déformation).
    const cover = await gradientPng(2000, 3000);
    const out = await optimizeImage(cover, { maxWidth: 1080, maxHeight: 1600 });
    const d = await Jimp.read(out.buffer);
    expect(d.width).toBeLessThanOrEqual(1080);
    expect(d.height).toBeLessThanOrEqual(1600);
    expect(d.width / d.height).toBeCloseTo(2000 / 3000, 2); // proportions conservées
  });

  it("endpoint /site-cover : renvoie une image JPG légère en pièce jointe", async () => {
    const app = await buildApp();
    try {
      const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "MISE_EN_PAGE" }, select: { id: true } });
      const editor = await createUserWithRole(`site_cover_ed_${rnd}`, "ADMIN_GENERAL", PWD);
      const m = await prisma.manuscript.create({
        data: {
          title: "Étés d'África: pluie & soleil",
          language: "fr",
          manuscriptNumber: `MS-COVER-${rnd}`,
          statusId: status.id,
          ownerId: editor.id,
          receivedAt: new Date(),
        },
      });

      // Couverture lourde en qualité impression (grande image PNG « photo »).
      const bigCover = await gradientPng(2400, 3600);
      const stored = await storeFile(bigCover, "couverture-print.png");
      const doc = await prisma.document.create({
        data: { entityType: "manuscript", entityId: m.id, category: "visuel", title: "Couverture" },
      });
      const version = await prisma.documentVersion.create({
        data: { documentId: doc.id, versionNumber: 1, filePath: stored.filePath, fileSize: stored.fileSize, mimeType: "image/png", sha256Hash: stored.sha256Hash },
      });
      await prisma.imageAsset.create({
        data: { manuscriptId: m.id, type: "couverture_1", documentVersionId: version.id },
      });

      // La fonction renvoie une image plus légère que l'original.
      const optimized = await optimizedCoverForSite(m.id);
      expect(optimized).not.toBeNull();
      expect(optimized!.mime).toBe("image/jpeg");
      expect(optimized!.buffer.length).toBeLessThan(bigCover.length);
      expect(optimized!.filename).toMatch(/^couverture-.*\.jpg$/);
      expect(optimized!.filename).not.toMatch(/[àáâéè:& ]/); // nom propre, sans accents ni espaces

      // Format portrait du site : tient dans 1080×1600, proportions gardées
      // (couverture entière — la source 2400×3600 = 2:3 reste 2:3, non déformée).
      const decodedCover = await Jimp.read(optimized!.buffer);
      expect(decodedCover.width).toBeLessThanOrEqual(1080);
      expect(decodedCover.height).toBeLessThanOrEqual(1600);
      const srcRatio = 2400 / 3600;
      expect(decodedCover.width / decodedCover.height).toBeCloseTo(srcRatio, 2);

      const cookie = await login(app, `site_cover_ed_${rnd}`, PWD);
      const res = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${m.id}/site-cover`, headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("image/jpeg");
      expect(String(res.headers["content-disposition"])).toContain("attachment");
      expect(res.rawPayload.length).toBeLessThan(bigCover.length);
    } finally {
      await app.close();
    }
  }, 30000);
});
