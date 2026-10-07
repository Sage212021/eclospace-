import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

function checkDigit(first12: string): number {
  const sum = first12.split("").map(Number).reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}
function mkIsbn(first12: string): string {
  return first12 + checkDigit(first12);
}

// Chargement de nouveaux ISBN disponibles (écran Administrateur) : validation du
// chiffre de contrôle, dédoublonnage (liste + banque), erreurs explicites.
describe("Chargement d'ISBN disponibles (admin)", () => {
  let app: FastifyInstance;
  let cookie: string;
  // Base unique pour ne pas heurter les ISBN du seed (97899560xxxx).
  const base = `97811${String(Date.now()).slice(-7)}`.slice(0, 12).padEnd(12, "0");
  const a = mkIsbn(base);
  const b = mkIsbn(String(Number(base) + 1).padStart(12, "0"));
  const existing = mkIsbn(String(Number(base) + 2).padStart(12, "0"));
  const badCheck = base.slice(0, 12) + String((checkDigit(base) + 1) % 10); // chiffre de contrôle faux
  const tooShort = "978995607";

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    // Un ISBN déjà présent → doit être signalé « déjà en banque » (jamais réutilisé).
    await prisma.isbn.create({ data: { isbn13: existing, format: "print", status: "available" } });
  });

  afterAll(async () => {
    await prisma.isbn.deleteMany({ where: { isbn13: { in: [a, b, existing] } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("charge les numéros valides, rejette checksum/longueur, ignore les doublons (liste + banque)", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/isbn-bank/load", headers: { cookie },
      payload: {
        isbns: [
          `${a.slice(0, 3)}-${a.slice(3, 7)}-${a.slice(7, 8)}-${a.slice(8, 12)}-${a.slice(12)}`, // a avec tirets
          b,
          b, // doublon dans la liste
          existing, // déjà en banque
          badCheck, // chiffre de contrôle faux
          tooShort, // trop court
          "   ", // ligne vide → ignorée en silence
        ],
      },
    });
    expect(r.statusCode).toBe(200);
    const res = r.json() as { created: number; created_list: string[]; duplicates: number; invalid: { value: string; reason: string }[] };
    expect(res.created).toBe(2); // a + b
    expect(res.created_list.sort()).toEqual([a, b].sort());
    expect(res.duplicates).toBe(2); // b en double + existing déjà en banque
    expect(res.invalid.length).toBe(2); // badCheck + tooShort

    const rowA = await prisma.isbn.findFirstOrThrow({ where: { isbn13: a } });
    expect(rowA.status).toBe("available");
    expect(rowA.format).toBe("print");
  });

  it("refuse une charge vide (aucun numéro)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/isbn-bank/load", headers: { cookie }, payload: { isbns: [] } });
    expect(r.statusCode).toBe(400);
  });
});
