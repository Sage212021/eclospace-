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

// Import des anciens ISBN (Lot 4, spec §7) : intégration + contrôle des doublons.
describe("Import des anciens ISBN dans la Banque", () => {
  let app: FastifyInstance;
  let cookie: string;
  const base = String(Date.now()).slice(-8);
  const a = `97891${base}`.slice(0, 13).padEnd(13, "0");
  const b = `97892${base}`.slice(0, 13).padEnd(13, "0");
  const bHyphen = `${b.slice(0, 3)}-${b.slice(3, 7)}-${b.slice(7, 10)}-${b.slice(10)}`; // même numéro, avec tirets
  const existing = `97893${base}`.slice(0, 13).padEnd(13, "0");

  beforeAll(async () => {
    app = await buildApp();
    cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    // Un ISBN déjà présent → doit être ignoré à l'import (doublon).
    await prisma.isbn.create({ data: { isbn13: existing, format: "print", status: "available" } });
  });

  afterAll(async () => {
    await prisma.isbn.deleteMany({ where: { isbn13: { in: [a, b, existing] } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("importe les nouveaux ISBN, ignore les doublons (fichier + banque) et classe par statut", async () => {
    const rows = [
      { isbn13: a, title: "Vieux Roman", author: "A. Ancien", format: "print", status: "attribue", assigned_at: "2020-05-01" },
      { isbn13: bHyphen, title: "Autre Titre", status: "disponible" }, // numéro avec tirets → normalisé
      { isbn13: b, title: "Doublon interne" }, // même numéro que bHyphen → doublon dans le fichier
      { isbn13: existing, title: "Déjà en banque" }, // doublon avec la banque
      { isbn13: "   ", title: "vide" }, // erreur
    ];
    const r = await app.inject({ method: "POST", url: "/api/v1/isbn-bank/import", headers: { cookie }, payload: { rows } });
    expect(r.statusCode).toBe(200);
    const res = r.json() as { created: number; duplicates: number; errors: unknown[] };
    expect(res.created).toBe(2); // a + b
    expect(res.duplicates).toBe(2); // b en double dans le fichier + existing déjà en banque
    expect(res.errors.length).toBe(1); // l'ISBN vide

    const rowA = await prisma.isbn.findFirstOrThrow({ where: { isbn13: a } });
    expect(rowA.status).toBe("assigned");
    expect(rowA.title).toBe("Vieux Roman");
    expect(rowA.authorName).toBe("A. Ancien");

    const rowB = await prisma.isbn.findFirstOrThrow({ where: { isbn13: b } }); // stocké normalisé
    expect(rowB.status).toBe("available");
    expect(rowB.title).toBe("Autre Titre");
  });

  it("l'ISBN importé apparaît dans la banque avec son titre (sans manuscrit lié)", async () => {
    const r = await app.inject({ method: "GET", url: `/api/v1/isbn-bank?q=${a}`, headers: { cookie } });
    const items = (r.json() as { items: { isbn13: string; title: string | null; author: string | null; bank_status: string }[] }).items;
    const found = items.find((i) => i.isbn13 === a);
    expect(found?.title).toBe("Vieux Roman");
    expect(found?.author).toBe("A. Ancien");
    expect(found?.bank_status).toBe("attribue");
  });
});
