import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Import EN MASSE d'ouvrages déjà parus (fonds) pour alimenter le catalogue :
// chaque ligne crée un ouvrage « publié » (isBackCatalogue), classé par domaine
// + collection ; doublons ignorés, lignes en erreur isolées, ISBN best-effort.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("import en masse d'ouvrages du fonds", () => {
  let app: FastifyInstance;
  let cookie: string;
  const s = rnd();
  const titles = { ok: `Roman Fonds ${s}`, dup: `Roman Fonds ${s}`, bad: `Mauvais domaine ${s}`, noYear: `Sans Annee ${s}` };

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    const ms = await prisma.manuscript.findMany({ where: { title: { in: [titles.ok, titles.noYear] } }, select: { id: true } });
    const ids = ms.map((m) => m.id);
    if (ids.length) {
      await prisma.isbn.deleteMany({ where: { manuscriptId: { in: ids } } }).catch(() => {});
      await prisma.workMetadata.deleteMany({ where: { manuscriptId: { in: ids } } }).catch(() => {});
      await prisma.workContributor.deleteMany({ where: { manuscriptId: { in: ids } } }).catch(() => {});
      await prisma.manuscript.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
    }
    await app.close();
    await prisma.$disconnect();
  });

  it("crée les ouvrages valides, ignore les doublons et isole les erreurs", async () => {
    const isbn = `978-9956-99-${s.slice(0, 3)}-1`;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts/import/bulk",
      headers: { cookie },
      payload: {
        rows: [
          { title: titles.ok, author: "Jean Essai Test", genre: "Roman", collection: "Canari", isbn, publication_date: "2022", age_range: "20-35 ans", summary: "Résumé du fonds." },
          { title: titles.dup, author: "Autre Auteur", genre: "Roman", publication_date: "2023" },
          { title: titles.bad, author: "X Y", genre: "DomaineInexistant", publication_date: "2022" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const b = res.json() as { created: number; skipped: number; errors: number; results: { title: string; status: string; message?: string }[] };
    expect(b.created).toBe(1);
    expect(b.skipped).toBe(1); // le doublon de titre
    expect(b.errors).toBe(1); // domaine inconnu

    // L'ouvrage créé est au catalogue : publié, fonds, genre + collection résolus.
    const m = await prisma.manuscript.findFirstOrThrow({
      where: { title: titles.ok },
      include: { status: { select: { code: true } }, genre: { select: { label: true } }, collection: { select: { code: true } }, workContributors: { include: { partner: true } }, workMetadata: true },
    });
    expect(m.status.code).toBe("SUIVI_POST_PUBLICATION");
    expect(m.isBackCatalogue).toBe(true);
    expect(m.genre?.label).toBe("Roman");
    expect(m.collection?.code).toBe("CANARIE"); // « Canari » imprimé → collection officielle
    expect(m.publicationDate?.getUTCFullYear()).toBe(2022);
    expect(m.workContributors[0]?.partner.lastName).toBe("Test");
    expect(m.workMetadata?.ageRange).toBe("20-35 ans");

    // ISBN connu enregistré et rattaché à l'ouvrage.
    const norm = isbn.replace(/[^0-9Xx]/g, "").toUpperCase();
    const isbnRow = await prisma.isbn.findUnique({ where: { isbn13: norm } });
    expect(isbnRow?.manuscriptId).toBe(m.id);
  });

  it("accepte une année vide : ouvrage créé au catalogue, sans date de parution", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/manuscripts/import/bulk", headers: { cookie },
      payload: { rows: [{ title: titles.noYear, author: "Olga Lona", genre: "Roman", collection: "Source", publication_date: "" }] },
    });
    expect(res.statusCode).toBe(200);
    const b = res.json() as { created: number; errors: number };
    expect(b.created).toBe(1);
    expect(b.errors).toBe(0);
    const m = await prisma.manuscript.findFirstOrThrow({
      where: { title: titles.noYear },
      include: { status: { select: { code: true } } },
    });
    expect(m.status.code).toBe("SUIVI_POST_PUBLICATION"); // bien au catalogue
    expect(m.publicationDate).toBeNull();
    expect(m.isBackCatalogue).toBe(false);
  });

  it("refuse une date de parution future (ligne en erreur, pas de création)", async () => {
    const title = `Futur ${rnd()}`;
    const res = await app.inject({
      method: "POST", url: "/api/v1/manuscripts/import/bulk", headers: { cookie },
      payload: { rows: [{ title, author: "A B", genre: "Roman", publication_date: "2099" }] },
    });
    const b = res.json() as { created: number; errors: number };
    expect(b.created).toBe(0);
    expect(b.errors).toBe(1);
    expect(await prisma.manuscript.findFirst({ where: { title } })).toBeNull();
  });
});
