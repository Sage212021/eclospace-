import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

// Prix de la fiche de métadonnées : public (PPT), promotionnel (stocké). La
// remise −25 % est calculée à l'affichage (frontend) — pas stockée ici.
describe("Métadonnées — prix public / promotionnel", () => {
  let app: FastifyInstance;
  let cookie: string;
  let manuscriptId = "";
  const s = Math.random().toString(36).slice(2, 7);

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    cookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const st = await prisma.workflowStatus.findFirstOrThrow();
    const m = await prisma.manuscript.create({ data: { manuscriptNumber: `MS-PRIX-${s}`, title: `Prix ${s}`, language: "fr", statusId: st.id, ownerId: adminId, receivedAt: new Date(), createdBy: adminId, updatedBy: adminId } });
    manuscriptId = m.id;
  });

  afterAll(async () => {
    await prisma.workMetadata.deleteMany({ where: { manuscriptId } }).catch(() => {});
    await prisma.manuscript.deleteMany({ where: { id: manuscriptId } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it("enregistre et renvoie le prix public (PPT) et le prix promotionnel", async () => {
    const patch = await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${manuscriptId}/metadata`, headers: { cookie }, payload: { price_public: 12000, price_promo: 8000 } });
    expect(patch.statusCode).toBe(200);
    const get = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/metadata`, headers: { cookie } });
    const b = get.json() as { pricePublic: string | null; pricePromo: string | null };
    expect(Number(b.pricePublic)).toBe(12000);
    expect(Number(b.pricePromo)).toBe(8000);
    // La remise −25 % se déduit du prix public (contrôle du calcul attendu côté écran).
    expect(Math.round(Number(b.pricePublic) * 0.75)).toBe(9000);
  });

  it("le prix promotionnel peut être vidé (null)", async () => {
    await app.inject({ method: "PATCH", url: `/api/v1/manuscripts/${manuscriptId}/metadata`, headers: { cookie }, payload: { price_promo: null } });
    const get = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/metadata`, headers: { cookie } });
    expect((get.json() as { pricePromo: string | null }).pricePromo).toBeNull();
  });
});
