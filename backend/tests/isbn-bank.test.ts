import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

type BankItem = { id: string; isbn13: string; bank_status: string; title: string | null; format: string };

describe("Banque des ISBN (Lot 1)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  const tag = Math.random().toString(36).slice(2, 7);
  const isbnDispo = `979-BANKA-${tag}`;
  const isbnAttr = `979-BANKB-${tag}`;
  const isbnAnnul = `979-BANKC-${tag}`;
  let manuscriptId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "ATTRIBUTION_REFERENCES" } });
    const ms = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-BANK-${tag}`, title: `Ouvrage Banque ${tag}`, statusId: status.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    manuscriptId = ms.id;
    await prisma.isbn.create({ data: { isbn13: isbnDispo, format: "print", status: "available" } });
    await prisma.isbn.create({ data: { isbn13: isbnAttr, format: "print", status: "assigned", manuscriptId, assignedAt: new Date(), assignedBy: adminId } });
    await prisma.isbn.create({ data: { isbn13: isbnAnnul, format: "epub", status: "cancelled", observations: "Numéro erroné" } });
  });

  afterAll(async () => {
    await prisma.isbn.deleteMany({ where: { isbn13: { in: [isbnDispo, isbnAttr, isbnAnnul] } } });
    await prisma.manuscript.deleteMany({ where: { id: manuscriptId } });
    await app.close();
    await prisma.$disconnect();
  });

  async function bank(params = "") {
    const r = await app.inject({ method: "GET", url: `/api/v1/isbn-bank${params}`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    return r.json() as { summary: { total: number; disponible: number; attribue: number; annule: number }; items: BankItem[] };
  }

  it("classe les ISBN par statut et expose un tableau de bord", async () => {
    const { summary, items } = await bank();
    // Compteurs cohérents (au moins nos 3 ajouts, en plus du catalogue seedé).
    expect(summary.total).toBe(summary.disponible + summary.attribue + summary.annule);
    const dispo = items.find((i) => i.isbn13 === isbnDispo);
    const attr = items.find((i) => i.isbn13 === isbnAttr);
    const annul = items.find((i) => i.isbn13 === isbnAnnul);
    expect(dispo?.bank_status).toBe("disponible");
    expect(attr?.bank_status).toBe("attribue");
    expect(attr?.title).toBe(`Ouvrage Banque ${tag}`); // titre repris du manuscrit lié
    expect(annul?.bank_status).toBe("annule");
  });

  it("recherche par numéro et filtre par statut / format", async () => {
    const byNumber = await bank(`?q=${encodeURIComponent(isbnAttr)}`);
    expect(byNumber.items.map((i) => i.isbn13)).toEqual([isbnAttr]);

    const dispoOnly = await bank(`?status=disponible`);
    expect(dispoOnly.items.some((i) => i.isbn13 === isbnDispo)).toBe(true);
    expect(dispoOnly.items.some((i) => i.isbn13 === isbnAttr)).toBe(false);

    const epubOnly = await bank(`?format=epub`);
    expect(epubOnly.items.every((i) => i.format === "epub")).toBe(true);
  });

  it("annule un ISBN disponible (conservé, plus proposé)", async () => {
    const id = (await prisma.isbn.findUniqueOrThrow({ where: { isbn13: isbnDispo } })).id;
    const r = await app.inject({ method: "POST", url: `/api/v1/isbn/${id}/cancel`, headers: { cookie }, payload: { observations: "Retiré" } });
    expect(r.statusCode).toBe(200);
    const after = await prisma.isbn.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("cancelled");
    // Toujours présent dans la banque (jamais supprimé), en statut annulé.
    const { items } = await bank(`?q=${encodeURIComponent(isbnDispo)}`);
    expect(items[0]?.bank_status).toBe("annule");
  });

  it("refuse d'annuler un ISBN déjà attribué à un ouvrage", async () => {
    const id = (await prisma.isbn.findUniqueOrThrow({ where: { isbn13: isbnAttr } })).id;
    const r = await app.inject({ method: "POST", url: `/api/v1/isbn/${id}/cancel`, headers: { cookie }, payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("isbn_attributed");
  });
});
