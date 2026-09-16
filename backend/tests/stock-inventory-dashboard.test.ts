import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie, uniqueIsbnPrefix } from "./helpers.js";
import type { FastifyInstance } from "fastify";

// Améliorations « inventaire permanent » (D-037) : justificatif + bénéficiaire
// sur un mouvement, tableau de bord, fluctuation par catégorie et par ouvrage.
// Le cœur (mouvements = source de vérité) est déjà couvert ailleurs ; ici on
// vérifie les NOUVELLES vues et champs.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

function multipartFile(filename: string, contentType: string, content: Buffer) {
  const boundary = "----ecl" + Math.random().toString(36).slice(2);
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, content, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("Inventaire permanent — tableau de bord, fluctuation, justificatifs (D-037)", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let genreId: string;
  let warehouseId: string;
  let isbnId: string;

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };
  const move = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/v1/stock-movements", headers: { cookie }, payload: { print_run: 0, ...payload } });

  async function newIsbn(title: string) {
    const created = await app.inject({ method: "POST", url: "/api/v1/manuscripts", headers: { cookie }, payload: { title, genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "Auteur", last_name: title } } });
    const manuscript = created.json();
    const partnerId = (await prisma.workContributor.findFirstOrThrow({ where: { manuscriptId: manuscript.id } })).partnerId;
    const contract = (await app.inject({ method: "POST", url: "/api/v1/contracts", headers: { cookie }, payload: { type: "edition", manuscript_id: manuscript.id, partner_id: partnerId, financial_terms: {} } })).json();
    for (const status of ["legal_review", "direction_approval", "awaiting_signature", "active"]) {
      await app.inject({ method: "PATCH", url: `/api/v1/contracts/${contract.id}/status`, headers: { cookie }, payload: { status } });
    }
    const pool = await app.inject({ method: "POST", url: "/api/v1/isbn-pools", headers: { cookie }, payload: { prefix: uniqueIsbnPrefix(1), digit_width: 1, range_start: 0, range_end: 9 } });
    const isbn = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscript.id}/isbn`, headers: { cookie }, payload: { format: "print", pool_id: pool.json().id } });
    return isbn.json().id as string;
  }

  beforeAll(async () => {
    app = await buildApp();
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    cookie = await login("admin", ADMIN_PASSWORD);
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
    warehouseId = (await app.inject({ method: "POST", url: "/api/v1/stock-locations", headers: { cookie }, payload: { type: "entrepot", label: "Entrepôt inventaire permanent" } })).json().id;
    isbnId = await newIsbn("Inventaire Permanent Test");

    // Scénario opérateur (tests 1-6) :
    await move({ type: "inventory_adjustment", isbn_id: isbnId, to_location_id: warehouseId, quantity: 500, reason: "Chargement inventaire initial" }); // initial 500
    await move({ type: "sale_out", isbn_id: isbnId, from_location_id: warehouseId, quantity: 20, reason: "Vente comptoir", beneficiary: "Client X" }); // -20 → 480
    await move({ type: "customer_return", isbn_id: isbnId, to_location_id: warehouseId, quantity: 5, reason: "Retour client" }); // +5 → 485
    await move({ type: "production_in", isbn_id: isbnId, to_location_id: warehouseId, quantity: 100, reason: "Réapprovisionnement" }); // +100 → 585
    await move({ type: "destruction", isbn_id: isbnId, from_location_id: warehouseId, quantity: 10, reason: "Exemplaires détruits", beneficiary: "Infiltration magasin" }); // -10 vendable → 575
    await move({ type: "free_out", isbn_id: isbnId, from_location_id: warehouseId, quantity: 5, reason: "Don institutionnel", beneficiary: "Association X" }); // -5 → 570
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("fiche/fluctuation par ouvrage : initial 500, entrées 105, sorties 35, disponible 570", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/stock-fluctuation-by-book", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const row = (res.json().rows as Array<Record<string, number | string>>).find((r) => r.isbn_id === isbnId)!;
    expect(row).toBeTruthy();
    expect(row.initial).toBe(500);
    expect(row.entries).toBe(105); // 5 (retour) + 100 (réappro)
    expect(row.exits).toBe(35); // 20 (vente) + 10 (destruction) + 5 (don)
    expect(row.adjustments).toBe(0);
    expect(row.available).toBe(570); // vendable restant
  });

  it("fluctuation par catégorie (filtrée sur l'ouvrage) : sorties ventilées par motif", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/stock-fluctuation?isbn_id=${isbnId}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: { type: string; quantity: number }[]; exits: { type: string; quantity: number }[]; total_out: number };
    const exit = (t: string) => body.exits.find((r) => r.type === t)?.quantity ?? 0;
    const entry = (t: string) => body.entries.find((r) => r.type === t)?.quantity ?? 0;
    expect(exit("sale_out")).toBe(20);
    expect(exit("destruction")).toBe(10);
    expect(exit("free_out")).toBe(5);
    expect(entry("production_in")).toBe(100);
    expect(entry("customer_return")).toBe(5);
    expect(body.total_out).toBe(35);
  });

  it("le bénéficiaire est conservé sur le mouvement", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/stock-movements?isbn_id=${isbnId}`, headers: { cookie } });
    const moves = res.json() as Array<{ type: string; beneficiary: string | null }>;
    expect(moves.find((m) => m.type === "free_out")?.beneficiary).toBe("Association X");
    expect(moves.find((m) => m.type === "destruction")?.beneficiary).toBe("Infiltration magasin");
  });

  it("tableau de bord : indicateurs cohérents", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/stock-dashboard", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const d = res.json() as Record<string, number>;
    // Bornes basses (la base est partagée avec d'autres tests) :
    expect(d.stock_total).toBeGreaterThanOrEqual(570);
    expect(d.destroyed_damaged_month).toBeGreaterThanOrEqual(10);
    expect(d.offered_month).toBeGreaterThanOrEqual(5);
    expect(typeof d.low_stock_count).toBe("number");
    expect(typeof d.replenishments_in_progress).toBe("number");
  });

  it("justificatif : dépôt puis consultation, marqué sur le mouvement", async () => {
    const created = (await move({ type: "destruction", isbn_id: isbnId, from_location_id: warehouseId, quantity: 2, reason: "Destruction avec PV", beneficiary: "Magasin" })).json() as { id: string };
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"); // en-tête PNG minimal
    const mp = multipartFile("pv-destruction.png", "image/png", png);
    const up = await app.inject({ method: "POST", url: `/api/v1/stock-movements/${created.id}/justification`, headers: { cookie, "content-type": mp.contentType }, payload: mp.body });
    expect(up.statusCode).toBe(201);
    expect(up.json().has_justification).toBe(true);

    const list = await app.inject({ method: "GET", url: `/api/v1/stock-movements?isbn_id=${isbnId}`, headers: { cookie } });
    const moves = list.json() as Array<{ id: string; has_justification: boolean }>;
    expect(moves.find((m) => m.id === created.id)?.has_justification).toBe(true);

    const view = await app.inject({ method: "GET", url: `/api/v1/stock-movements/${created.id}/justification`, headers: { cookie } });
    expect(view.statusCode).toBe(200);
    expect(view.headers["content-type"]).toContain("image/png");
  });
});
