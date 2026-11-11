import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

// Nouvelle tranche officielle d'ISBN (Direction du Livre, Cameroun) chargée au
// stock « disponible » : 978-9956-0-7986-5 → 978-9956-0-8014-4 (29 numéros).

describe("Stock d'ISBN disponibles — nouvelle tranche", () => {
  beforeAll(async () => { await buildApp(); });
  afterAll(async () => { await prisma.$disconnect(); });

  // Bornes et quelques points de la tranche (sans tirets).
  const samples = ["9789956079865", "9789956079995", "9789956080007", "9789956080106", "9789956080144"];

  it("charge les nouveaux ISBN au statut « disponible »", async () => {
    const rows = await prisma.isbn.findMany({ where: { isbn13: { in: samples } }, select: { isbn13: true, status: true } });
    expect(rows.length).toBe(samples.length);
    for (const r of rows) expect(r.status).toBe("available");
  });

  it("retient le bon 8010 (…-6) et écarte le doublon erroné du scan (…-3)", async () => {
    expect(await prisma.isbn.findUnique({ where: { isbn13: "9789956080106" } })).not.toBeNull(); // 8010-6 (correct)
    expect(await prisma.isbn.findUnique({ where: { isbn13: "9789956080103" } })).toBeNull();       // 8010-3 (clé erronée, écarté)
  });

  it("la tranche complète 7986→8014 (29 numéros) est présente et unique", async () => {
    const all: string[] = [];
    for (let t = 7986; t <= 8014; t++) {
      const base = "97899560" + String(t).padStart(4, "0");
      let s = 0;
      for (let i = 0; i < 12; i++) s += Number(base[i]) * (i % 2 ? 3 : 1);
      all.push(base + String((10 - (s % 10)) % 10));
    }
    expect(all.length).toBe(29);
    const found = await prisma.isbn.count({ where: { isbn13: { in: all }, status: "available" } });
    expect(found).toBe(29);
  });
});
