import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Contrôle qualité des exemplaires imprimés (Ch. 14 §14.7) : à la réception d'un
// tirage, l'utilisateur enregistre la quantité reçue, pose un verdict qualité
// (conforme / avec réserves / non conforme), coche les points vérifiés
// (checklist) et peut ouvrir une réclamation. La quantité est corrigible.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("réception & contrôle qualité des exemplaires imprimés", () => {
  let app: FastifyInstance;
  let cookie: string;
  let printerId: string;

  beforeAll(async () => {
    app = await buildApp();
    cookie = await loginCookie(app);
    const partner = await prisma.partner.create({ data: { category: "imprimeur", firstName: "Presses", lastName: `QC ${Date.now()}` } });
    const printer = await app.inject({ method: "POST", url: "/api/v1/printers", headers: { cookie }, payload: { partner_id: partner.id, specialties: [] } });
    printerId = printer.json().id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // Amène un bon de commande jusqu'au statut « envoyé » (prêt à recevoir un tirage).
  async function purchaseOrderReady(): Promise<{ poId: string; ordered: number }> {
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    const genre = await prisma.genre.findFirstOrThrow();
    const m = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie },
      payload: { title: `QC ${Date.now()}-${Math.random()}`, genre_id: genre.id, language: "fr", owner_id: admin.id, evaluation_fee_choice: "sans_frais", author: { first_name: "A", last_name: "B", email: "a@b.co", id_type: "CNI", id_number: "1" } },
    });
    const manuscriptId = m.json().id as string;
    // La consultation imprimeur (Ch. 15 §15.1) exige un BAT signé : on en pose un
    // directement, le circuit BAT complet étant couvert par d'autres suites.
    await prisma.batRecord.create({ data: { manuscriptId, cycleNumber: 1, status: "signed" } });
    const quote = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/print-quotes`, headers: { cookie }, payload: { printer_id: printerId, quantities: [500] } });
    const quoteId = quote.json().id as string;
    await app.inject({ method: "PATCH", url: `/api/v1/print-quotes/${quoteId}`, headers: { cookie }, payload: { amounts: { "500": 400000 } } });
    await app.inject({ method: "POST", url: `/api/v1/print-quotes/${quoteId}/select`, headers: { cookie }, payload: { selection_motive: "OK", chosen_quantity: 500 } });
    const po = await app.inject({ method: "POST", url: `/api/v1/print-quotes/${quoteId}/purchase-order`, headers: { cookie }, payload: {} });
    const poId = po.json().id as string;
    await app.inject({ method: "PATCH", url: `/api/v1/purchase-orders/${poId}/status`, headers: { cookie }, payload: { status: "sent" } });
    return { poId, ordered: 500 };
  }

  async function recordReceipt(poId: string, quantity: number): Promise<string> {
    const r = await app.inject({ method: "POST", url: `/api/v1/purchase-orders/${poId}/goods-receipts`, headers: { cookie }, payload: { quantity_received: quantity } });
    return r.json().id as string;
  }

  it("expose le catalogue des points de contrôle qualité", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/qc-checklist-items", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as { code: string; label: string }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.map((i) => i.code)).toContain("couverture");
  });

  it("enregistre le verdict, la checklist et le commentaire de contrôle qualité", async () => {
    const { poId } = await purchaseOrderReady();
    const receiptId = await recordReceipt(poId, 500);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/goods-receipts/${receiptId}/qc`,
      headers: { cookie },
      payload: {
        verdict: "with_reserves",
        checklist: [
          { code: "couverture", ok: true },
          { code: "faconnage", ok: false, note: "collage fragile" },
        ],
        comment: "Quelques exemplaires à surveiller.",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.qcVerdict).toBe("with_reserves");
    expect(body.qcComment).toBe("Quelques exemplaires à surveiller.");
    expect(body.qcChecklist).toHaveLength(2);
    expect(body.qcChecklist[1]).toMatchObject({ code: "faconnage", ok: false, note: "collage fragile" });
  });

  it("refuse un point de checklist inconnu", async () => {
    const { poId } = await purchaseOrderReady();
    const receiptId = await recordReceipt(poId, 500);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/goods-receipts/${receiptId}/qc`,
      headers: { cookie },
      payload: { verdict: "conform", checklist: [{ code: "inexistant", ok: true }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("corrige la quantité reçue et recalcule l'écart", async () => {
    const { poId } = await purchaseOrderReady();
    const receiptId = await recordReceipt(poId, 500);
    const res = await app.inject({ method: "PATCH", url: `/api/v1/goods-receipts/${receiptId}`, headers: { cookie }, payload: { quantity_received: 480 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().quantityReceived).toBe(480);
    expect(res.json().variance).toBe(-20); // 480 - 500 commandés
  });

  it("ouvre une réclamation fournisseur, renvoyée avec la réception", async () => {
    const { poId } = await purchaseOrderReady();
    const receiptId = await recordReceipt(poId, 500);
    const claim = await app.inject({ method: "POST", url: `/api/v1/goods-receipts/${receiptId}/claims`, headers: { cookie }, payload: { description: "Dos décollé sur un lot." } });
    expect(claim.statusCode).toBe(201);

    const orders = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${(await prisma.goodsReceipt.findUniqueOrThrow({ where: { id: receiptId }, include: { po: { include: { quote: true } } } })).po.quote.manuscriptId}/purchase-orders`, headers: { cookie } });
    const receipt = orders.json().flatMap((o: { goodsReceipts: { id: string; claims: unknown[] }[] }) => o.goodsReceipts).find((r: { id: string }) => r.id === receiptId);
    expect(receipt.claims).toHaveLength(1);
  });
});
