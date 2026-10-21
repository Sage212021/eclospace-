import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 7);

describe("Réception magasinier : entrée directe (Cas A) + ouvrage absent du catalogue (Cas B)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let magasinierCookie: string;
  let correcteurCookie: string;
  let isbnId: string;
  let manuscriptId: string;
  let locationId: string;

  const login = async (u: string, p: string) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    adminCookie = await login("admin", ADMIN_PASSWORD);
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const mag = await createUserWithRole(`mag_${rnd()}`, "MAGASINIER", "MagStock123!");
    magasinierCookie = await login(mag.username, "MagStock123!");
    const corr = await createUserWithRole(`corr_${rnd()}`, "CORRECTEUR", "CorrStock123!");
    correcteurCookie = await login(corr.username, "CorrStock123!");

    const status = await prisma.workflowStatus.findFirstOrThrow();
    const m = await prisma.manuscript.create({ data: { manuscriptNumber: `MAG-${rnd()}`, title: `Ouvrage Stock ${rnd()}`, language: "fr", statusId: status.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } });
    manuscriptId = m.id;
    const isbn = await prisma.isbn.create({ data: { isbn13: `978${Date.now()}`.slice(0, 13), format: "print", manuscriptId: m.id, status: "assigned" } });
    isbnId = isbn.id;
    const loc = await prisma.stockLocation.create({ data: { type: "entrepot", label: `Magasin test ${rnd()}` } });
    locationId = loc.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function physical() {
    const items = await prisma.stockItem.findMany({ where: { isbnId, locationId } });
    return items.reduce((s, i) => s + i.quantityPhysical, 0);
  }

  it("le magasinier enregistre une entrée directe → le stock augmente, le mouvement est tracé", async () => {
    const before = await physical();
    const r = await app.inject({ method: "POST", url: "/api/v1/stock/receptions", headers: { cookie: magasinierCookie }, payload: { isbn_id: isbnId, location_id: locationId, quantity: 30, provenance: "don", observations: "Don d'une association" } });
    expect(r.statusCode).toBe(201);
    expect(await physical()).toBe(before + 30);
    // Traçabilité : mouvement d'entrée, magasinier identifié, réception directe.
    const mv = await prisma.stockMovement.findUniqueOrThrow({ where: { id: r.json().id } });
    expect(mv.type).toBe("supplier_in");
    expect(mv.referenceType).toBe("direct_reception");
    expect(mv.quantity).toBe(30);
    expect(mv.movedBy).toBeTruthy();
  });

  it("refuse une entrée sans quantité valide / ISBN inconnu", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/v1/stock/receptions", headers: { cookie: magasinierCookie }, payload: { isbn_id: isbnId, location_id: locationId, quantity: 0, provenance: "don" } });
    expect(bad.statusCode).toBe(400);
    const noIsbn = await app.inject({ method: "POST", url: "/api/v1/stock/receptions", headers: { cookie: magasinierCookie }, payload: { isbn_id: "00000000-0000-0000-0000-000000000000", location_id: locationId, quantity: 5, provenance: "don" } });
    expect(noIsbn.statusCode).toBe(404);
  });

  it("réserve la réception au magasin (403 pour un correcteur sans droit stock)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/stock/receptions", headers: { cookie: correcteurCookie }, payload: { isbn_id: isbnId, location_id: locationId, quantity: 5, provenance: "don" } });
    expect(r.statusCode).toBe(403);
  });

  it("Cas B : le magasinier signale un ouvrage absent ; le service habilité le rattache et le stock est mis à jour", async () => {
    const title = `Ouvrage hors catalogue ${rnd()}`;
    const req = await app.inject({ method: "POST", url: "/api/v1/stock/fiche-requests", headers: { cookie: magasinierCookie }, payload: { title, author_name: "Awa N.", provenance: "fournisseur", quantity: 12, observations: "Reçu sans fiche" } });
    expect(req.statusCode).toBe(201);
    const reqId = req.json().id as string;

    // Visible dans la file des demandes.
    const list = await app.inject({ method: "GET", url: "/api/v1/stock/fiche-requests?status=pending", headers: { cookie: magasinierCookie } });
    expect((list.json().requests as Array<{ id: string }>).some((r) => r.id === reqId)).toBe(true);

    // Le magasinier ne peut PAS rattacher lui-même (réservé au service habilité).
    const forbidden = await app.inject({ method: "POST", url: `/api/v1/stock/fiche-requests/${reqId}/fulfill`, headers: { cookie: magasinierCookie }, payload: { isbn_id: isbnId, location_id: locationId } });
    expect(forbidden.statusCode).toBe(403);

    // Le service habilité rattache la demande à une fiche existante → stock crédité.
    const before = await physical();
    const ful = await app.inject({ method: "POST", url: `/api/v1/stock/fiche-requests/${reqId}/fulfill`, headers: { cookie: adminCookie }, payload: { isbn_id: isbnId, location_id: locationId } });
    expect(ful.statusCode).toBe(200);
    expect(await physical()).toBe(before + 12);
    const after = await prisma.stockFicheRequest.findUniqueOrThrow({ where: { id: reqId } });
    expect(after.status).toBe("fulfilled");
    expect(after.manuscriptId).toBe(manuscriptId);
    expect(after.resolvedBy).toBeTruthy();
  });

  it("Cas B : une demande peut être rejetée avec motif par le service habilité", async () => {
    const req = await app.inject({ method: "POST", url: "/api/v1/stock/fiche-requests", headers: { cookie: magasinierCookie }, payload: { title: `À rejeter ${rnd()}`, quantity: 1 } });
    const reqId = req.json().id as string;
    const rej = await app.inject({ method: "POST", url: `/api/v1/stock/fiche-requests/${reqId}/reject`, headers: { cookie: adminCookie }, payload: { reason: "Doublon d'une fiche existante." } });
    expect(rej.statusCode).toBe(200);
    const after = await prisma.stockFicheRequest.findUniqueOrThrow({ where: { id: reqId } });
    expect(after.status).toBe("rejected");
    expect(after.rejectReason).toContain("Doublon");
  });
});
