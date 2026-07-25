import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import { salesByBook } from "../src/lib/salesTracking.js";

// Suivi des ventes par ouvrage : sorties vs ventes réelles (montant) + écart.
// On isole un ISBN de test (isbn13 unique) : sa ligne « par ouvrage » ne
// contient donc que les enregistrements créés ici, quel que soit le reste de
// la base.

function rndIsbn(): string {
  let s = "97";
  for (let i = 0; i < 11; i++) s += Math.floor(Math.random() * 10);
  return s;
}

const PWD = "SalesTrack123!";

describe("suivi des ventes par ouvrage", () => {
  let app: FastifyInstance;
  let isbnId: string;

  beforeAll(async () => {
    app = await buildApp();
    const isbn = await prisma.isbn.create({ data: { isbn13: rndIsbn(), format: "print" } });
    isbnId = isbn.id;

    // Sorties : vente 10, exemplaire auteur 3, pilon 2  -> 15 sortis.
    await prisma.stockMovement.createMany({
      data: [
        { type: "sale_out", isbnId, printRun: 1, quantity: 10 },
        { type: "author_copy", isbnId, printRun: 1, quantity: 3 },
        { type: "pulping", isbnId, printRun: 1, quantity: 2 },
      ],
    });
    // Ventes réelles : 8 exemplaires à 5 000 -> 40 000 encaissés.
    await prisma.posSale.create({ data: { isbnId, quantity: 8, unitPrice: "5000.00", paymentMethod: "cash" } });

    await createUserWithRole("sbb_commercial", "RESP_COMMERCIAL", PWD);
    await createUserWithRole("sbb_magasinier", "MAGASINIER", PWD);
  });

  afterAll(async () => {
    await prisma.posSale.deleteMany({ where: { isbnId } });
    await prisma.stockMovement.deleteMany({ where: { isbnId } });
    await prisma.isbn.delete({ where: { id: isbnId } });
    await app.close();
  });

  it("agrège sorties, vendus, montant et écart par ouvrage", async () => {
    const res = await salesByBook({ granularity: "month" });
    const row = res.by_book.find((r) => r.key === isbnId);
    expect(row).toBeDefined();
    expect(row!.units_out).toBe(15);
    expect(row!.units_sold).toBe(8);
    expect(row!.amount).toBe(40000);
    expect(row!.gap).toBe(7); // 15 sortis − 8 vendus
  });

  it("découpe par semaine sur une fenêtre isolée", async () => {
    const iso = await prisma.isbn.create({ data: { isbn13: rndIsbn(), format: "print" } });
    // Fenêtre lointaine et isolée (aucune autre donnée attendue).
    const d = new Date("2039-03-16T10:00:00.000Z"); // mercredi, semaine ISO 11
    await prisma.stockMovement.create({ data: { type: "sale_out", isbnId: iso.id, printRun: 1, quantity: 5, movedAt: d } });
    await prisma.posSale.create({ data: { isbnId: iso.id, quantity: 4, unitPrice: "1000.00", paymentMethod: "cash", soldAt: d } });

    const res = await salesByBook({ from: new Date("2039-03-01"), to: new Date("2039-03-31"), granularity: "week" });
    expect(res.totals.units_out).toBe(5);
    expect(res.totals.units_sold).toBe(4);
    expect(res.totals.amount).toBe(4000);
    // Une seule semaine concernée, au format AAAA-Sxx.
    expect(res.by_period.length).toBe(1);
    expect(res.by_period[0].key).toMatch(/^2039-S\d{2}$/);
    expect(res.by_period[0].units_out).toBe(5);

    await prisma.posSale.deleteMany({ where: { isbnId: iso.id } });
    await prisma.stockMovement.deleteMany({ where: { isbnId: iso.id } });
    await prisma.isbn.delete({ where: { id: iso.id } });
  });

  it("permissions : commercial 200, magasinier 403", async () => {
    const login = async (u: string) => {
      const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: PWD } });
      return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    };
    const ok = await app.inject({ method: "GET", url: "/api/v1/commercial/sales-by-book?granularity=month", headers: { cookie: await login("sbb_commercial") } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toHaveProperty("by_book");

    const denied = await app.inject({ method: "GET", url: "/api/v1/commercial/sales-by-book", headers: { cookie: await login("sbb_magasinier") } });
    expect(denied.statusCode).toBe(403);
  });
});
