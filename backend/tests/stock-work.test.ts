import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// « Mon espace Stock & magasin » (D-058) : le Responsable Stock voit les ouvrages
// aux étapes qu'il gère en priorité (Impression, Réception et mise en stock,
// Commercialisation) et peut agir (fixer le prix, clôturer la commercialisation).

const rnd = () => Math.random().toString(36).slice(2, 8);
let seq = 0;
const nextIsbn13 = () => `978${String(Date.now()).slice(-7)}${String(seq++).padStart(3, "0")}`;

describe("Mon espace Stock & magasin (D-058)", () => {
  let app: FastifyInstance;
  let magasinierCookie: string;
  let adminId: string;

  beforeAll(async () => {
    app = await buildApp();
    const mag = await createUserWithRole(`mag_${rnd()}`, "MAGASINIER", "Mag123!");
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: mag.username, password: "Mag123!" } });
    magasinierCookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function manuscriptAt(code: string, withIsbn = true) {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-SW-${rnd()}`, title: `SW ${rnd()}`, statusId: status.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    // Étape courante SANS responsable (transmise « à tout le service ») → auto-clôture possible.
    await prisma.manuscriptStep.create({ data: { manuscriptId: m.id, statusId: status.id, responsibleId: null, actualStart: new Date() } });
    let isbnId: string | null = null;
    if (withIsbn) {
      const isbn = await prisma.isbn.create({ data: { isbn13: nextIsbn13(), format: "print", status: "assigned", manuscriptId: m.id } });
      isbnId = isbn.id;
    }
    return { id: m.id, isbnId };
  }

  it("liste les ouvrages aux 3 étapes du pôle Stock, avec le motif d'attente", async () => {
    const impr = await manuscriptAt("IMPRESSION");
    const recep = await manuscriptAt("CONTROLE_QUALITE_IMPRESSION");
    const comm = await manuscriptAt("COMMERCIALISATION");

    const res = await app.inject({ method: "GET", url: "/api/v1/my-stock-work", headers: { cookie: magasinierCookie } });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { manuscript_id: string; step_code: string; blocked_reason: string | null; detail: string | null }[];

    const byId = (id: string) => rows.find((r) => r.manuscript_id === id);
    expect(byId(impr.id)?.step_code).toBe("IMPRESSION");
    expect(byId(impr.id)?.blocked_reason).toMatch(/bon de commande/i);
    expect(byId(recep.id)?.step_code).toBe("CONTROLE_QUALITE_IMPRESSION");
    expect(byId(recep.id)?.blocked_reason).toMatch(/réception/i);
    expect(byId(comm.id)?.step_code).toBe("COMMERCIALISATION");
    expect(byId(comm.id)?.blocked_reason).toMatch(/prix/i);
  });

  it("le magasinier peut définir le prix public (droit ouvert au Stock, D-058)", async () => {
    const comm = await manuscriptAt("COMMERCIALISATION");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/isbn/${comm.isbnId}/prices`,
      headers: { cookie: magasinierCookie },
      payload: { country: "Cameroun", currency: "XAF", price: 5000, effective_from: "2026-11-01T00:00:00.000Z" },
    });
    expect(res.statusCode).toBeLessThan(300);
  });

  it("le magasinier clôture lui-même la commercialisation une fois le prix défini → Vente & livraison", async () => {
    const comm = await manuscriptAt("COMMERCIALISATION");
    // Bloqué tant qu'aucun prix.
    const blocked = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${comm.id}/steps/COMMERCIALISATION/validate`, headers: { cookie: magasinierCookie }, payload: {} });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("price_missing");

    await app.inject({
      method: "POST",
      url: `/api/v1/isbn/${comm.isbnId}/prices`,
      headers: { cookie: magasinierCookie },
      payload: { country: "Cameroun", currency: "XAF", price: 5000, effective_from: "2026-11-01T00:00:00.000Z" },
    });

    const ok = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${comm.id}/steps/COMMERCIALISATION/validate`, headers: { cookie: magasinierCookie }, payload: {} });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("VENTE_LIVRAISON");
  });

  it("refuse l'accès à un utilisateur sans droit stock", async () => {
    const other = await createUserWithRole(`corr_${rnd()}`, "CORRECTEUR", "Corr123!");
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: other.username, password: "Corr123!" } });
    const cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    const res = await app.inject({ method: "GET", url: "/api/v1/my-stock-work", headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });
});
