import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// RÉGRESSION « la remise ne s'intègre pas toujours » : un commercial peut avoir
// eu, historiquement, DEUX lieux de stock. L'état doit alors AGRÉGER tous ses
// lieux (aucune remise perdue), n'afficher qu'UNE ligne par commercial, et les
// nouvelles remises viser toujours le MÊME lieu (le plus ancien).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("Stock commercial — agrégation multi-lieux (doublon historique)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let isbnId: string;
  let entrepotId: string;
  let commercialId: string;
  let canonicalLocId: string;
  const s = Math.random().toString(36).slice(2, 7);

  const login = async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login();
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    isbnId = (await app.inject({ method: "POST", url: "/api/v1/commercial-stock/quick-good", headers: { cookie }, payload: { title: `Livre dup ${s}` } })).json().id;
    entrepotId = (await app.inject({ method: "POST", url: "/api/v1/stock-locations", headers: { cookie }, payload: { type: "entrepot", label: `Magasin dup ${s}` } })).json().id;
    await app.inject({ method: "POST", url: "/api/v1/stock-movements", headers: { cookie }, payload: { type: "production_in", isbn_id: isbnId, print_run: 0, to_location_id: entrepotId, quantity: 100, reason: "Tirage" } });
    commercialId = (await createUserWithRole(`com_dup_${s}`, "COMMERCIAL", "ComDup1!")).id;

    // 1ʳᵉ remise via l'endpoint → crée le lieu CANONIQUE (le plus ancien).
    await app.inject({ method: "POST", url: `/api/v1/commercial-stock/${commercialId}/handover`, headers: { cookie }, payload: { isbn_id: isbnId, quantity: 5, location_id: entrepotId } });
    canonicalLocId = (await prisma.stockLocation.findFirstOrThrow({ where: { commercialUserId: commercialId, type: "stock_commercial" }, orderBy: { createdAt: "asc" } })).id;

    // Simule un DOUBLON historique : un 2ᵉ lieu du même commercial, avec une
    // remise passée (mouvement d'entrée) qui y a atterri.
    const dupLoc = await prisma.stockLocation.create({ data: { type: "stock_commercial", label: `Stock commercial (doublon) ${s}`, commercialUserId: commercialId } });
    await prisma.stockMovement.create({ data: { type: "transfer", isbnId, printRun: 0, fromLocationId: entrepotId, toLocationId: dupLoc.id, quantity: 6, reason: "Remise (ancien lieu)", status: "completed", condition: "vendable", movedBy: adminId } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("agrège les remises de TOUS les lieux du commercial (aucune perdue)", async () => {
    const all = (await app.inject({ method: "GET", url: "/api/v1/commercial-stock", headers: { cookie } })).json() as { reps: Array<{ user_id: string; recus: number }> };
    const mine = all.reps.filter((r) => r.user_id === commercialId);
    // UNE seule ligne pour ce commercial (pas une par lieu).
    expect(mine.length).toBe(1);
    // Reçus = 5 (canonique) + 6 (doublon historique) = 11.
    expect(mine[0].recus).toBe(11);

    const moves = (await app.inject({ method: "GET", url: `/api/v1/commercial-stock/${commercialId}/movements`, headers: { cookie } })).json() as { movements: Array<{ direction: string; quantity: number }> };
    const recus = moves.movements.filter((m) => m.direction === "in");
    expect(recus.reduce((sum, m) => sum + m.quantity, 0)).toBe(11);
  });

  it("une nouvelle remise vise toujours le lieu canonique et s'ajoute au total", async () => {
    const r = await app.inject({ method: "POST", url: `/api/v1/commercial-stock/${commercialId}/handover`, headers: { cookie }, payload: { isbn_id: isbnId, quantity: 3, location_id: entrepotId } });
    expect(r.statusCode).toBe(201);
    expect(r.json().toLocationId).toBe(canonicalLocId); // pas un nouveau lieu

    const all = (await app.inject({ method: "GET", url: "/api/v1/commercial-stock", headers: { cookie } })).json() as { reps: Array<{ user_id: string; recus: number }> };
    expect(all.reps.find((x) => x.user_id === commercialId)!.recus).toBe(14); // 11 + 3
  });
});
