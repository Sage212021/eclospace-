import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { extractSessionCookie } from "./helpers.js";

// Étape unique « Réception et mise en stock » (D-056) : livraisons partielles
// cumulées, garde-fou de sur-réception, contrôle qualité quantitatif (conforme /
// non conforme), entrée en stock des SEULS exemplaires conformes, réceptions
// multiples contrôlées séparément, idempotence de la mise en stock.

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";
const rnd = () => Math.random().toString(36).slice(2, 8);
let isbnSeq = 0;
const nextIsbn13 = () => `978${String(Date.now()).slice(-7)}${String(isbnSeq++).padStart(3, "0")}`;

describe("Réception et mise en stock (D-056)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let locationId: string;

  beforeAll(async () => {
    app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: ADMIN_PASSWORD } });
    adminCookie = extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    const loc = await prisma.stockLocation.findFirstOrThrow({ where: { type: "entrepot" } });
    locationId = loc.id;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // Bon de commande « sent » minimal, pour un ouvrage doté d'un ISBN papier.
  async function makePo(ordered: number) {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "CONTROLE_QUALITE_IMPRESSION" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-RMS-${rnd()}`, title: `RMS ${rnd()}`, statusId: status.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    const isbn = await prisma.isbn.create({ data: { isbn13: nextIsbn13(), format: "print", status: "assigned", manuscriptId: m.id } });
    const partner = await prisma.partner.create({ data: { category: "imprimeur", firstName: "Imp", lastName: rnd() } });
    const printer = await prisma.printer.create({ data: { partnerId: partner.id, specialties: ["offset"] } });
    const quote = await prisma.printQuote.create({ data: { manuscriptId: m.id, printerId: printer.id, status: "selected", selectedQuantity: ordered, quantities: [ordered] } });
    const po = await prisma.purchaseOrder.create({
      data: { quoteId: quote.id, printerId: printer.id, poNumber: `PO-RMS-${rnd()}`, orderedQuantity: ordered, amount: 100000, status: "sent", quantityTolerancePct: 0 },
    });
    return { manuscriptId: m.id, isbnId: isbn.id, poId: po.id };
  }

  const receive = (poId: string, quantity: number, allowRegularization?: boolean) =>
    app.inject({ method: "POST", url: `/api/v1/purchase-orders/${poId}/goods-receipts`, headers: { cookie: adminCookie }, payload: { quantity_received: quantity, allow_regularization: allowRegularization } });
  const qc = (receiptId: string, verdict: string, quantityConform?: number) =>
    app.inject({ method: "PATCH", url: `/api/v1/goods-receipts/${receiptId}/qc`, headers: { cookie: adminCookie }, payload: { verdict, quantity_conform: quantityConform } });
  const enterStock = (receiptId: string) =>
    app.inject({ method: "POST", url: `/api/v1/goods-receipts/${receiptId}/stock-entry`, headers: { cookie: adminCookie }, payload: { location_id: locationId } });
  const stockOf = async (isbnId: string) =>
    (await prisma.stockItem.aggregate({ where: { isbnId }, _sum: { quantityPhysical: true } }))._sum.quantityPhysical ?? 0;

  it("livraisons partielles cumulées + garde-fou de sur-réception (régularisation sur autorisation)", async () => {
    const { poId } = await makePo(500);

    const r1 = await receive(poId, 300);
    expect(r1.statusCode).toBe(201);
    expect(r1.json().cumulative_received).toBe(300);
    expect(r1.json().remaining_after).toBe(200);

    const r2 = await receive(poId, 200);
    expect(r2.statusCode).toBe(201);
    expect(r2.json().cumulative_received).toBe(500);
    expect(r2.json().remaining_after).toBe(0);

    // Dépassement refusé...
    const over = await receive(poId, 50);
    expect(over.statusCode).toBe(409);
    expect(over.json().code).toBe("over_reception");

    // ...sauf régularisation explicitement autorisée.
    const reg = await receive(poId, 50, true);
    expect(reg.statusCode).toBe(201);
    expect(reg.json().cumulative_received).toBe(550);
  });

  it("contrôle qualité quantitatif : seuls les conformes entrent en stock, le non-conforme reste isolé", async () => {
    const { poId, isbnId } = await makePo(500);
    const rec = await receive(poId, 500);
    const receiptId = rec.json().id as string;

    // 480 conformes / 20 non conformes.
    const q = await qc(receiptId, "with_reserves", 480);
    expect(q.statusCode).toBe(200);
    expect(q.json().quantityConform).toBe(480);

    const entered = await enterStock(receiptId);
    expect(entered.statusCode).toBe(201);
    expect(entered.json().quantity_entered).toBe(480);

    // Le stock ne reçoit QUE les 480 conformes (pas les 500 reçus).
    expect(await stockOf(isbnId)).toBe(480);
  });

  it("réceptions multiples, chacune contrôlée et entrée séparément (stock = somme des conformes)", async () => {
    const { poId, isbnId } = await makePo(500);

    const a = await receive(poId, 300);
    const qa = await qc(a.json().id, "conform", 300);
    expect(qa.statusCode).toBe(200);
    await enterStock(a.json().id);

    const b = await receive(poId, 200);
    await qc(b.json().id, "with_reserves", 190); // 10 défectueux sur la 2e livraison
    await enterStock(b.json().id);

    expect(await stockOf(isbnId)).toBe(490);
  });

  it("réception entièrement non conforme : rien n'entre en stock", async () => {
    const { poId, isbnId } = await makePo(100);
    const rec = await receive(poId, 100);
    await qc(rec.json().id, "non_conform", 0);

    const entered = await enterStock(rec.json().id);
    expect(entered.statusCode).toBe(409);
    // Verdict non conforme → réception non acceptée : rien n'entre en stock.
    expect(entered.json().code).toBe("receipt_not_accepted");
    expect(await stockOf(isbnId)).toBe(0);
  });

  it("l'entrée en stock d'une réception est idempotente (pas de double comptage)", async () => {
    const { poId, isbnId } = await makePo(200);
    const rec = await receive(poId, 200);
    await qc(rec.json().id, "conform", 200);

    const first = await enterStock(rec.json().id);
    expect(first.statusCode).toBe(201);
    const second = await enterStock(rec.json().id);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("already_entered");

    expect(await stockOf(isbnId)).toBe(200);
  });

  // Ouvrage SANS bon de commande (déjà paru / importé) : même procédure réception
  // → contrôle qualité → entrée en stock, via une réception DIRECTE (D-061).
  async function makeBookWithoutPo() {
    const status = await prisma.workflowStatus.findFirstOrThrow({ where: { code: "CONTROLE_QUALITE_IMPRESSION" } });
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-DIR-${rnd()}`, title: `DIR ${rnd()}`, statusId: status.id, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    // Étape courante sans responsable → auto-clôture possible par le pôle Stock.
    await prisma.manuscriptStep.create({ data: { manuscriptId: m.id, statusId: status.id, responsibleId: null, actualStart: new Date() } });
    const isbn = await prisma.isbn.create({ data: { isbn13: nextIsbn13(), format: "print", status: "assigned", manuscriptId: m.id } });
    return { manuscriptId: m.id, isbnId: isbn.id };
  }

  it("réception DIRECTE sans bon de commande : réception → contrôle qualité → entrée en stock (D-061)", async () => {
    const { manuscriptId, isbnId } = await makeBookWithoutPo();

    // Aucune réception directe au départ.
    const empty = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/goods-receipts`, headers: { cookie: adminCookie } });
    expect(empty.statusCode).toBe(200);
    expect((empty.json() as unknown[]).length).toBe(0);

    // Réception directe de 150 exemplaires.
    const rec = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/goods-receipts`, headers: { cookie: adminCookie }, payload: { quantity_received: 150 } });
    expect(rec.statusCode).toBe(201);
    const receiptId = rec.json().id as string;

    const listed = await app.inject({ method: "GET", url: `/api/v1/manuscripts/${manuscriptId}/goods-receipts`, headers: { cookie: adminCookie } });
    expect((listed.json() as { id: string }[]).map((r) => r.id)).toContain(receiptId);

    // Contrôle qualité : 140 conformes / 10 non conformes.
    const q = await qc(receiptId, "with_reserves", 140);
    expect(q.statusCode).toBe(200);
    expect(q.json().quantityConform).toBe(140);

    // Entrée en stock des SEULS conformes.
    const entered = await enterStock(receiptId);
    expect(entered.statusCode).toBe(201);
    expect(entered.json().quantity_entered).toBe(140);
    expect(await stockOf(isbnId)).toBe(140);

    // La validation de l'étape passe ensuite vers Commercialisation.
    const price = await app.inject({ method: "POST", url: `/api/v1/isbn/${isbnId}/prices`, headers: { cookie: adminCookie }, payload: { country: "Cameroun", currency: "XAF", price: 5000, effective_from: "2026-11-01T00:00:00.000Z" } });
    expect(price.statusCode).toBeLessThan(300);
    const validate = await app.inject({ method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/steps/CONTROLE_QUALITE_IMPRESSION/validate`, headers: { cookie: adminCookie }, payload: {} });
    expect(validate.statusCode).toBe(200);
    expect(validate.json().status).toBe("COMMERCIALISATION");
  });
});
