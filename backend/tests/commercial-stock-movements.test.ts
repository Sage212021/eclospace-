import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Détail des mouvements d'un commercial : chaque remise/retour est tracé, et le
// « Reçus » du tableau = la somme exacte des mouvements reçus (aucun stock sans
// mouvement). Permet de vérifier « le magasin a remis X, le commercial affiche Y ».

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

describe("Stock commercial — détail des mouvements", () => {
  let app: FastifyInstance;
  let cookie: string;
  let isbnId: string;
  let entrepotId: string;
  let commercialId: string;
  const s = Math.random().toString(36).slice(2, 7);

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    cookie = await login("admin", ADMIN_PASSWORD);
    isbnId = (await app.inject({ method: "POST", url: "/api/v1/commercial-stock/quick-good", headers: { cookie }, payload: { title: `Livre détail ${s}` } })).json().id;
    entrepotId = (await app.inject({ method: "POST", url: "/api/v1/stock-locations", headers: { cookie }, payload: { type: "entrepot", label: `Magasin ${s}` } })).json().id;
    await app.inject({ method: "POST", url: "/api/v1/stock-movements", headers: { cookie }, payload: { type: "production_in", isbn_id: isbnId, print_run: 0, to_location_id: entrepotId, quantity: 100, reason: "Tirage" } });
    commercialId = (await createUserWithRole(`com_det_${s}`, "COMMERCIAL", "Com1pass!")).id;
    // Deux remises : 7 puis 4 (total reçu = 11).
    await app.inject({ method: "POST", url: `/api/v1/commercial-stock/${commercialId}/handover`, headers: { cookie }, payload: { isbn_id: isbnId, quantity: 7, location_id: entrepotId } });
    await app.inject({ method: "POST", url: `/api/v1/commercial-stock/${commercialId}/handover`, headers: { cookie }, payload: { isbn_id: isbnId, quantity: 4, location_id: entrepotId } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("liste chaque mouvement reçu et le total correspond au « Reçus » agrégé", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/commercial-stock/${commercialId}/movements`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { movements: Array<{ direction: string; quantity: number; type: string }> };
    const recus = body.movements.filter((m) => m.direction === "in");
    expect(recus.length).toBe(2);
    expect(recus.reduce((s2, m) => s2 + m.quantity, 0)).toBe(11); // 7 + 4

    // L'agrégat « Reçus » du tableau doit valoir exactement la somme des reçus.
    const all = (await app.inject({ method: "GET", url: "/api/v1/commercial-stock", headers: { cookie } })).json() as { reps: Array<{ user_id: string; recus: number }> };
    const mine = all.reps.find((r) => r.user_id === commercialId)!;
    expect(mine.recus).toBe(11);
  });

  it("renvoie une liste vide pour un commercial sans lieu de stock", async () => {
    const other = (await createUserWithRole(`com_vide_${s}`, "COMMERCIAL", "Com2pass!")).id;
    const res = await app.inject({ method: "GET", url: `/api/v1/commercial-stock/${other}/movements`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().movements).toEqual([]);
  });
});
