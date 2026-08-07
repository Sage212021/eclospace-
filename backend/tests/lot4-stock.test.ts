import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie, uniqueIsbnPrefix } from "./helpers.js";
import type { FastifyInstance } from "fastify";

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(response.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("Stock et magasin (Lot 4)", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminId: string;
  let genreId: string;
  let warehouseId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    adminCookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    const genre = await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } });
    genreId = genre.id;

    const warehouse = await app.inject({
      method: "POST",
      url: "/api/v1/stock-locations",
      headers: { cookie: adminCookie },
      payload: { type: "entrepot", label: "Entrepôt principal" },
    });
    warehouseId = warehouse.json().id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createIsbnForNewManuscript(title: string) {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/manuscripts",
      headers: { cookie: adminCookie },
      payload: { title, genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "Auteur", last_name: title } },
    });
    const manuscript = createResponse.json();
    const partnerId = (await prisma.workContributor.findFirstOrThrow({ where: { manuscriptId: manuscript.id } })).partnerId;
    const contractResponse = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { cookie: adminCookie },
      payload: { type: "edition", manuscript_id: manuscript.id, partner_id: partnerId, financial_terms: {} },
    });
    const contract = contractResponse.json();
    for (const status of ["legal_review", "direction_approval", "awaiting_signature", "active"]) {
      await app.inject({ method: "PATCH", url: `/api/v1/contracts/${contract.id}/status`, headers: { cookie: adminCookie }, payload: { status } });
    }
    const pool = await app.inject({
      method: "POST",
      url: "/api/v1/isbn-pools",
      headers: { cookie: adminCookie },
      payload: { prefix: uniqueIsbnPrefix(1), digit_width: 1, range_start: 0, range_end: 9 },
    });
    const isbn = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/isbn`,
      headers: { cookie: adminCookie },
      payload: { format: "print", pool_id: pool.json().id },
    });
    return { manuscript, isbnId: isbn.json().id as string };
  }

  it("le stock physique est la somme des mouvements (Ch. 16 §16.1, §16.4)", async () => {
    const { isbnId } = await createIsbnForNewManuscript("Manuscrit Stock Cohérence");

    const entry = await app.inject({
      method: "POST",
      url: "/api/v1/stock-movements",
      headers: { cookie: adminCookie },
      payload: { type: "production_in", isbn_id: isbnId, print_run: 0, to_location_id: warehouseId, quantity: 100, reason: "Réception fabrication" },
    });
    expect(entry.statusCode).toBe(201);

    const afterEntry = await app.inject({
      method: "GET",
      url: `/api/v1/stock-items?isbn_id=${isbnId}`,
      headers: { cookie: adminCookie },
    });
    expect(afterEntry.json()[0].quantityPhysical).toBe(100);
    expect(afterEntry.json()[0].quantityAvailable).toBe(100);

    const outflow = await app.inject({
      method: "POST",
      url: "/api/v1/stock-movements",
      headers: { cookie: adminCookie },
      payload: { type: "author_copy", isbn_id: isbnId, print_run: 0, from_location_id: warehouseId, quantity: 5, reason: "Exemplaires d'auteur (quota contractuel)" },
    });
    expect(outflow.statusCode).toBe(201);

    const afterOutflow = await app.inject({
      method: "GET",
      url: `/api/v1/stock-items?isbn_id=${isbnId}`,
      headers: { cookie: adminCookie },
    });
    expect(afterOutflow.json()[0].quantityPhysical).toBe(95);
  });

  it("aucun mouvement sans motif, sans lieu requis pour son type (Ch. 16 §16.4)", async () => {
    const { isbnId } = await createIsbnForNewManuscript("Manuscrit Stock Validation");

    const missingReason = await app.inject({
      method: "POST",
      url: "/api/v1/stock-movements",
      headers: { cookie: adminCookie },
      payload: { type: "production_in", isbn_id: isbnId, to_location_id: warehouseId, quantity: 10, reason: "" },
    });
    expect(missingReason.statusCode).toBe(400);

    const missingLocation = await app.inject({
      method: "POST",
      url: "/api/v1/stock-movements",
      headers: { cookie: adminCookie },
      payload: { type: "sale_out", isbn_id: isbnId, quantity: 10, reason: "Vente" },
    });
    expect(missingLocation.statusCode).toBe(400);
  });

  it("ignore un lieu de destination superflu sur un mouvement de sortie pure (régression)", async () => {
    const { isbnId } = await createIsbnForNewManuscript("Manuscrit Stock Lieu Superflu");
    await app.inject({
      method: "POST",
      url: "/api/v1/stock-movements",
      headers: { cookie: adminCookie },
      payload: { type: "production_in", isbn_id: isbnId, to_location_id: warehouseId, quantity: 50, reason: "Réception" },
    });

    const otherLocation = await app.inject({
      method: "POST",
      url: "/api/v1/stock-locations",
      headers: { cookie: adminCookie },
      payload: { type: "depot", label: "Dépôt sans rapport" },
    });

    // "author_copy" n'exige qu'un lieu d'origine ; un lieu de destination
    // envoyé par erreur ne doit surtout pas créditer ce second lieu.
    const movement = await app.inject({
      method: "POST",
      url: "/api/v1/stock-movements",
      headers: { cookie: adminCookie },
      payload: {
        type: "author_copy",
        isbn_id: isbnId,
        from_location_id: warehouseId,
        to_location_id: otherLocation.json().id,
        quantity: 5,
        reason: "Exemplaires d'auteur",
      },
    });
    expect(movement.statusCode).toBe(201);
    expect(movement.json().toLocationId).toBeNull();

    const originStock = await prisma.stockItem.findFirstOrThrow({ where: { isbnId, locationId: warehouseId } });
    expect(originStock.quantityPhysical).toBe(45);

    const phantomStock = await prisma.stockItem.findFirst({ where: { isbnId, locationId: otherLocation.json().id } });
    expect(phantomStock).toBeNull();
  });

  it("un rôle sans permission stock:saisie ne peut pas saisir de mouvement", async () => {
    const { isbnId } = await createIsbnForNewManuscript("Manuscrit Stock Permissions");
    await createUserWithRole("correcteur_stock_test", "CORRECTEUR", "Correcteur123!");
    const cookie = await loginCookie(app, "correcteur_stock_test", "Correcteur123!");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/stock-movements",
      headers: { cookie },
      payload: { type: "production_in", isbn_id: isbnId, to_location_id: warehouseId, quantity: 10, reason: "Test" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("un transfert reste en transit jusqu'à confirmation de réception (Ch. 16 §16.4)", async () => {
    const { isbnId } = await createIsbnForNewManuscript("Manuscrit Stock Transfert");
    const secondLocation = await app.inject({
      method: "POST",
      url: "/api/v1/stock-locations",
      headers: { cookie: adminCookie },
      payload: { type: "depot", label: "Dépôt secondaire" },
    });
    const secondLocationId = secondLocation.json().id;

    await app.inject({
      method: "POST",
      url: "/api/v1/stock-movements",
      headers: { cookie: adminCookie },
      payload: { type: "production_in", isbn_id: isbnId, to_location_id: warehouseId, quantity: 50, reason: "Réception" },
    });

    const transfer = await app.inject({
      method: "POST",
      url: "/api/v1/stock-movements",
      headers: { cookie: adminCookie },
      payload: { type: "transfer", isbn_id: isbnId, from_location_id: warehouseId, to_location_id: secondLocationId, quantity: 20, reason: "Réassort dépôt secondaire" },
    });
    expect(transfer.statusCode).toBe(201);
    expect(transfer.json().status).toBe("in_transit");

    const afterTransferOut = await prisma.stockItem.findFirst({ where: { isbnId, locationId: warehouseId } });
    expect(afterTransferOut?.quantityPhysical).toBe(30);
    const destinationBeforeConfirm = await prisma.stockItem.findFirst({ where: { isbnId, locationId: secondLocationId } });
    expect(destinationBeforeConfirm?.quantityPhysical ?? 0).toBe(0);

    const confirmed = await app.inject({
      method: "PATCH",
      url: `/api/v1/stock-movements/${transfer.json().id}/confirm-receipt`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe("completed");

    const destinationAfterConfirm = await prisma.stockItem.findFirst({ where: { isbnId, locationId: secondLocationId } });
    expect(destinationAfterConfirm?.quantityPhysical).toBe(20);
  });

  it("signale l'alerte et la rupture selon les seuils paramétrés (Ch. 16 §16.5)", async () => {
    const { isbnId } = await createIsbnForNewManuscript("Manuscrit Stock Alerte");
    await app.inject({
      method: "POST",
      url: "/api/v1/stock-movements",
      headers: { cookie: adminCookie },
      payload: { type: "production_in", isbn_id: isbnId, to_location_id: warehouseId, quantity: 10, reason: "Réception" },
    });
    const item = await prisma.stockItem.findFirstOrThrow({ where: { isbnId, locationId: warehouseId } });
    await prisma.stockItem.update({ where: { id: item.id }, data: { alertThreshold: 15, outOfStockThreshold: 0 } });

    const alerts = await app.inject({ method: "GET", url: "/api/v1/stock-alerts", headers: { cookie: adminCookie } });
    const alert = alerts.json().find((a: { isbnId: string }) => a.isbnId === isbnId);
    expect(alert).toBeDefined();
    expect(alert.severity).toBe("alerte");

    await app.inject({
      method: "POST",
      url: "/api/v1/stock-movements",
      headers: { cookie: adminCookie },
      payload: { type: "pulping", isbn_id: isbnId, from_location_id: warehouseId, quantity: 10, reason: "Invendus déclassés" },
    });
    const afterPulping = await app.inject({ method: "GET", url: "/api/v1/stock-alerts", headers: { cookie: adminCookie } });
    const ruptureAlert = afterPulping.json().find((a: { isbnId: string }) => a.isbnId === isbnId);
    expect(ruptureAlert.severity).toBe("rupture");
  });

  it("gère un inventaire à l'aveugle avec écart, recomptage et régularisation tracée (Ch. 16 §16.8)", async () => {
    const { isbnId } = await createIsbnForNewManuscript("Manuscrit Stock Inventaire");
    await app.inject({
      method: "POST",
      url: "/api/v1/stock-movements",
      headers: { cookie: adminCookie },
      payload: { type: "production_in", isbn_id: isbnId, to_location_id: warehouseId, quantity: 40, reason: "Réception" },
    });

    const opened = await app.inject({
      method: "POST",
      url: "/api/v1/inventories",
      headers: { cookie: adminCookie },
      payload: { type: "full", location_id: warehouseId, blind: true },
    });
    expect(opened.statusCode).toBe(201);
    const inventory = opened.json();
    const line = inventory.lines.find((l: { isbnId: string }) => l.isbnId === isbnId);
    expect(line.theoreticalQty).toBeUndefined(); // masqué : comptage à l'aveugle

    const gotInventory = await app.inject({ method: "GET", url: `/api/v1/inventories/${inventory.id}`, headers: { cookie: adminCookie } });
    const gotLine = gotInventory.json().lines.find((l: { isbnId: string }) => l.isbnId === isbnId);
    expect(gotLine.theoreticalQty).toBeUndefined();

    const firstCount = await app.inject({
      method: "PATCH",
      url: `/api/v1/inventory-lines/${line.id}`,
      headers: { cookie: adminCookie },
      payload: { counted_qty: 37 },
    });
    expect(firstCount.json().variance).toBe(-3);
    expect(firstCount.json().recountRequired).toBe(true);

    const prematureClose = await app.inject({ method: "PATCH", url: `/api/v1/inventories/${inventory.id}/close`, headers: { cookie: adminCookie } });
    expect(prematureClose.statusCode).toBe(409);

    const recount = await app.inject({
      method: "PATCH",
      url: `/api/v1/inventory-lines/${line.id}`,
      headers: { cookie: adminCookie },
      payload: { counted_qty: 37 },
    });
    expect(recount.json().recountRequired).toBe(false);

    const adjusted = await app.inject({
      method: "POST",
      url: `/api/v1/inventory-lines/${line.id}/adjust`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(adjusted.statusCode).toBe(200);
    expect(adjusted.json().adjustmentMovementId).not.toBeNull();

    const stockAfterAdjustment = await prisma.stockItem.findFirstOrThrow({ where: { isbnId, locationId: warehouseId } });
    expect(stockAfterAdjustment.quantityPhysical).toBe(37);

    const closed = await app.inject({ method: "PATCH", url: `/api/v1/inventories/${inventory.id}/close`, headers: { cookie: adminCookie } });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().status).toBe("closed");
  });

  it("fait entrer en stock les seuls exemplaires acceptés par le contrôle qualité (Ch. 16 §16.4, Ch. 15 §15.7)", async () => {
    const { manuscript, isbnId } = await createIsbnForNewManuscript("Manuscrit Stock Reception Fabrication");

    await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/legal-deposits`,
      headers: { cookie: adminCookie },
      payload: { country: "France", depository: "BnF", copies_required: 2 },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/metadata`,
      headers: { cookie: adminCookie },
      payload: { summary: "Résumé", weight_grams: 300, thema_codes: ["FBA"] },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/production-specs`,
      headers: { cookie: adminCookie },
      payload: { trim_format: "14x21", final_pages: 200, paper_interior: "Offset 80g", paper_interior_gsm: 80, paper_cover: "Couché 250g", binding: "broche" },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/manuscripts/${manuscript.id}/production-specs`,
      headers: { cookie: adminCookie },
      payload: { lamination: "mate" },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/image-assets`,
      headers: { cookie: adminCookie },
      payload: { type: "couverture_1", resolution_dpi: 300, color_mode: "cmjn", rights_origin: "creation_interne" },
    });
    const document = await prisma.document.create({ data: { entityType: "manuscript", entityId: manuscript.id, category: "bat", title: "Fichiers BAT" } });
    const interiorVersion = await prisma.documentVersion.create({
      data: { documentId: document.id, versionNumber: 1, filePath: "interior.pdf", fileSize: 1000, mimeType: "application/pdf", sha256Hash: "interiorhash", status: "validated" },
    });
    const coverVersion = await prisma.documentVersion.create({
      data: { documentId: document.id, versionNumber: 2, filePath: "cover.pdf", fileSize: 500, mimeType: "application/pdf", sha256Hash: "coverhash", status: "validated" },
    });
    const opened = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/bat`,
      headers: { cookie: adminCookie },
      payload: { interior_version_id: interiorVersion.id, cover_version_id: coverVersion.id },
    });
    const bat = opened.json();
    for (const item of bat.checklist.items) {
      await app.inject({ method: "PATCH", url: `/api/v1/checklist-items/${item.id}`, headers: { cookie: adminCookie }, payload: { checked: true } });
    }
    await app.inject({ method: "PATCH", url: `/api/v1/bat/${bat.id}/status`, headers: { cookie: adminCookie }, payload: { status: "awaiting_signature" } });
    await app.inject({ method: "POST", url: `/api/v1/bat/${bat.id}/sign`, headers: { cookie: adminCookie }, payload: {} });

    const partner = await prisma.partner.create({ data: { category: "imprimeur", firstName: "Presses", lastName: "Test Stock" } });
    const printer = await app.inject({ method: "POST", url: "/api/v1/printers", headers: { cookie: adminCookie }, payload: { partner_id: partner.id, specialties: [] } });
    const quoteResponse = await app.inject({
      method: "POST",
      url: `/api/v1/manuscripts/${manuscript.id}/print-quotes`,
      headers: { cookie: adminCookie },
      payload: { printer_id: printer.json().id, quantities: [500] },
    });
    const quote = quoteResponse.json();
    await app.inject({ method: "PATCH", url: `/api/v1/print-quotes/${quote.id}`, headers: { cookie: adminCookie }, payload: { amounts: { "500": 400000 } } });
    await app.inject({
      method: "POST",
      url: `/api/v1/print-quotes/${quote.id}/select`,
      headers: { cookie: adminCookie },
      payload: { selection_motive: "OK", chosen_quantity: 500 },
    });
    const poResponse = await app.inject({ method: "POST", url: `/api/v1/print-quotes/${quote.id}/purchase-order`, headers: { cookie: adminCookie }, payload: {} });
    const po = poResponse.json();

    const receipt = await app.inject({
      method: "POST",
      url: `/api/v1/purchase-orders/${po.id}/goods-receipts`,
      headers: { cookie: adminCookie },
      payload: { quantity_received: 500 },
    });

    const beforeQc = await app.inject({
      method: "POST",
      url: `/api/v1/goods-receipts/${receipt.json().id}/stock-entry`,
      headers: { cookie: adminCookie },
      payload: { location_id: warehouseId },
    });
    expect(beforeQc.statusCode).toBe(409);
    expect(beforeQc.json().code).toBe("receipt_not_accepted");

    await app.inject({
      method: "PATCH",
      url: `/api/v1/goods-receipts/${receipt.json().id}/qc`,
      headers: { cookie: adminCookie },
      payload: { verdict: "conform" },
    });

    const stockEntry = await app.inject({
      method: "POST",
      url: `/api/v1/goods-receipts/${receipt.json().id}/stock-entry`,
      headers: { cookie: adminCookie },
      payload: { location_id: warehouseId },
    });
    expect(stockEntry.statusCode).toBe(201);

    const stockItem = await prisma.stockItem.findFirstOrThrow({ where: { isbnId, locationId: warehouseId } });
    expect(stockItem.quantityPhysical).toBe(500);
  });

  it("inventaire : campagne, comptage avec écart, régularisation et clôture", async () => {
    // Lieu dédié pour isoler les lignes d'inventaire.
    const loc = (await app.inject({ method: "POST", url: "/api/v1/stock-locations", headers: { cookie: adminCookie }, payload: { type: "emplacement", label: "Cartons — inventaire" } })).json();
    const { isbnId } = await createIsbnForNewManuscript("Manuscrit Inventaire");
    await app.inject({ method: "POST", url: "/api/v1/stock-movements", headers: { cookie: adminCookie }, payload: { type: "production_in", isbn_id: isbnId, to_location_id: loc.id, quantity: 100, reason: "Réception" } });

    // Campagne (comptage visible pour la simplicité du test).
    const inv = (await app.inject({ method: "POST", url: "/api/v1/inventories", headers: { cookie: adminCookie }, payload: { type: "full", location_id: loc.id, blind: false } })).json();
    expect(inv.lines.length).toBe(1);

    // Liste + avancement.
    const list = (await app.inject({ method: "GET", url: "/api/v1/inventories", headers: { cookie: adminCookie } })).json();
    const row = list.find((r: { id: string }) => r.id === inv.id);
    expect(row.total_lines).toBe(1);
    expect(row.counted_lines).toBe(0);

    // Détail enrichi (titre + ISBN).
    const detail = (await app.inject({ method: "GET", url: `/api/v1/inventories/${inv.id}`, headers: { cookie: adminCookie } })).json();
    const lineId = detail.lines[0].id;
    expect(detail.lines[0].title).toBe("Manuscrit Inventaire");
    expect(detail.lines[0].theoreticalQty).toBe(100);

    // Premier comptage avec écart → recomptage demandé.
    const c1 = (await app.inject({ method: "PATCH", url: `/api/v1/inventory-lines/${lineId}`, headers: { cookie: adminCookie }, payload: { counted_qty: 95 } })).json();
    expect(c1.variance).toBe(-5);
    expect(c1.recountRequired).toBe(true);
    // Second comptage confirme l'écart.
    const c2 = (await app.inject({ method: "PATCH", url: `/api/v1/inventory-lines/${lineId}`, headers: { cookie: adminCookie }, payload: { counted_qty: 95 } })).json();
    expect(c2.recountRequired).toBe(false);

    // Clôture refusée tant que l'écart n'est pas régularisé.
    const early = await app.inject({ method: "PATCH", url: `/api/v1/inventories/${inv.id}/close`, headers: { cookie: adminCookie } });
    expect(early.statusCode).toBe(409);

    // Régularisation → mouvement d'ajustement, stock ramené à 95.
    const adj = await app.inject({ method: "POST", url: `/api/v1/inventory-lines/${lineId}/adjust`, headers: { cookie: adminCookie } });
    expect(adj.statusCode).toBe(200);
    const item = await prisma.stockItem.findFirstOrThrow({ where: { isbnId, locationId: loc.id } });
    expect(item.quantityPhysical).toBe(95);

    // Clôture désormais possible.
    const close = await app.inject({ method: "PATCH", url: `/api/v1/inventories/${inv.id}/close`, headers: { cookie: adminCookie } });
    expect(close.statusCode).toBe(200);
    expect(close.json().status).toBe("closed");
  });
});
