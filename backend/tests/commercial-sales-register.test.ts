import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Registre des ventes au comptoir + récapitulatif annuel (par ouvrage / par
// auteur). Rappel : la vente au comptoir ne modifie plus le stock (découplée) et
// reste toujours enregistrable pour que le commercial VOIE sa vente.

describe("registre des ventes au comptoir & récap annuel", () => {
  let app: FastifyInstance;
  let repCookie: string;
  let otherCookie: string;
  const tag = `REG-${Date.now()}`;

  beforeAll(async () => {
    app = await buildApp();
    await createUserWithRole("rep_ventes", "RESP_COMMERCIAL", "RepVentes123!");
    const rep = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "rep_ventes", password: "RepVentes123!" } });
    repCookie = extractSessionCookie(rep.cookies.map((c) => `${c.name}=${c.value}`));
    await createUserWithRole("rep_autre", "RESP_COMMERCIAL", "RepAutre123!");
    const other = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "rep_autre", password: "RepAutre123!" } });
    otherCookie = extractSessionCookie(other.cookies.map((c) => `${c.name}=${c.value}`));
  });

  afterAll(async () => {
    await prisma.posSale.deleteMany({ where: { offCatalogueTitle: { startsWith: tag } } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("enregistre une vente au comptoir (hors catalogue) sans stock et la restitue enrichie", async () => {
    const create = await app.inject({
      method: "POST", url: "/api/v1/pos-sales", headers: { cookie: repCookie },
      payload: { off_catalogue_title: `${tag} Le Baobab`, off_catalogue_author: "Awa Diallo", quantity: 2, unit_price: 5000, payment_method: "cash" },
    });
    expect(create.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: "/api/v1/pos-sales?mine=true", headers: { cookie: repCookie } });
    expect(list.statusCode).toBe(200);
    const row = (list.json() as Array<{ title: string; author: string; total: number; quantity: number }>).find((r) => r.title === `${tag} Le Baobab`);
    expect(row).toBeTruthy();
    expect(row!.author).toBe("Awa Diallo");
    expect(row!.total).toBe(10000); // 2 × 5 000
  });

  it("enregistre une vente du catalogue même quand le lieu (location_id) est vide", async () => {
    // Bug signalé (20/08/2026) : le formulaire envoyait location_id = "" quand le
    // commercial n'a pas de lieu de stock → l'API rejetait « » (pas un UUID) et
    // « ça buggait à l'enregistrement ». La chaîne vide doit être ignorée.
    const isbn = await prisma.isbn.findFirst({ where: { status: "published" }, select: { id: true } });
    expect(isbn).toBeTruthy();
    const res = await app.inject({
      method: "POST", url: "/api/v1/pos-sales", headers: { cookie: repCookie },
      payload: { isbn_id: isbn!.id, location_id: "", customer_id: "", point_of_sale_id: "", quantity: 1, unit_price: 4000, payment_method: "cash" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("le filtre « mine » isole les ventes du commercial courant", async () => {
    await app.inject({
      method: "POST", url: "/api/v1/pos-sales", headers: { cookie: otherCookie },
      payload: { off_catalogue_title: `${tag} Vente collègue`, off_catalogue_author: "Autre", quantity: 1, unit_price: 3000, payment_method: "cash" },
    });
    const mine = await app.inject({ method: "GET", url: "/api/v1/pos-sales?mine=true", headers: { cookie: repCookie } });
    const titles = (mine.json() as Array<{ title: string }>).map((r) => r.title);
    expect(titles).toContain(`${tag} Le Baobab`);
    expect(titles).not.toContain(`${tag} Vente collègue`); // vente d'un autre commercial
  });

  it("récapitulatif annuel : agrège par ouvrage et par auteur", async () => {
    const year = new Date().getUTCFullYear();
    // Une 2e vente du même ouvrage pour cumuler.
    await app.inject({
      method: "POST", url: "/api/v1/pos-sales", headers: { cookie: repCookie },
      payload: { off_catalogue_title: `${tag} Le Baobab`, off_catalogue_author: "Awa Diallo", quantity: 3, unit_price: 5000, payment_method: "cash" },
    });
    const res = await app.inject({ method: "GET", url: `/api/v1/commercial/sales-annual?year=${year}`, headers: { cookie: repCookie } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    const book = (b.by_book as Array<{ label: string; quantity: number; revenue: number }>).find((x) => x.label === `${tag} Le Baobab`);
    expect(book).toBeTruthy();
    expect(book!.quantity).toBe(5); // 2 + 3
    expect(book!.revenue).toBe(25000);
    const author = (b.by_author as Array<{ label: string; quantity: number }>).find((x) => x.label === "Awa Diallo");
    expect(author!.quantity).toBe(5);
  });
});
