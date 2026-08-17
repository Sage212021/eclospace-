import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie, uniqueIsbnPrefix } from "./helpers.js";

// Annulation d'une vente au comptoir saisie par erreur (décision opérateur
// 17/08/2026). Règles vérifiées :
//  • Vente au catalogue → avoir émis + droits d'auteur contre-passés (somme = 0)
//    + Direction financière notifiée ; la vente passe « annulée » (jamais effacée).
//  • Vente hors catalogue (provisoire) → simple annulation, sans effet comptable.
//  • La vente n'a jamais touché le stock : l'annulation n'y touche pas non plus.
//  • Ventes annulées exclues des agrégats (récap annuel, total « Mes ventes »).
//  • Double annulation refusée (409) ; motif obligatoire (400) ; mois clôturé (409).

const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!";

async function loginCookie(app: FastifyInstance, username: string, password: string) {
  const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
}

describe("annulation d'une vente au comptoir", () => {
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;
  let genreId: string;

  beforeAll(async () => {
    app = await buildApp();
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    adminId = admin.id;
    cookie = await loginCookie(app, "admin", ADMIN_PASSWORD);
    genreId = (await prisma.genre.findUniqueOrThrow({ where: { code: "ROMAN" } })).id;
    // Un destinataire pour la notification « Direction financière ».
    await createUserWithRole("resp_finance_cancel_test", "RESP_FINANCE", "RespFinance123!");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // Crée un ouvrage AU CATALOGUE avec un contrat de droits actif (paliers) et un
  // ISBN imprimé, prêt pour une vente comptoir facturée générant des droits.
  async function createCatalogueIsbn(title: string) {
    const m = await app.inject({
      method: "POST", url: "/api/v1/manuscripts", headers: { cookie },
      payload: { title, genre_id: genreId, language: "fr", owner_id: adminId, author: { first_name: "Auteur", last_name: title } },
    });
    const manuscriptId = m.json().id as string;
    const partnerId = (await prisma.workContributor.findFirstOrThrow({ where: { manuscriptId } })).partnerId;
    const contract = await app.inject({
      method: "POST", url: "/api/v1/contracts", headers: { cookie },
      payload: { type: "edition", manuscript_id: manuscriptId, partner_id: partnerId, financial_terms: { base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.1 }] } },
    });
    const contractId = contract.json().id as string;
    for (const status of ["legal_review", "direction_approval", "awaiting_signature", "active"]) {
      await app.inject({ method: "PATCH", url: `/api/v1/contracts/${contractId}/status`, headers: { cookie }, payload: { status } });
    }
    const pool = await app.inject({
      method: "POST", url: "/api/v1/isbn-pools", headers: { cookie },
      payload: { prefix: uniqueIsbnPrefix(1), digit_width: 1, range_start: 0, range_end: 9 },
    });
    const isbn = await app.inject({
      method: "POST", url: `/api/v1/manuscripts/${manuscriptId}/isbn`, headers: { cookie },
      payload: { format: "print", pool_id: pool.json().id },
    });
    return { isbnId: isbn.json().id as string, contractId };
  }

  it("annule une vente AU CATALOGUE : avoir émis, droits contre-passés, Finance notifiée", async () => {
    const { isbnId, contractId } = await createCatalogueIsbn(`Catalogue ${uniqueIsbnPrefix(2)}`);
    const created = await app.inject({
      method: "POST", url: "/api/v1/pos-sales", headers: { cookie },
      payload: { isbn_id: isbnId, quantity: 3, unit_price: 10000, payment_method: "cash" },
    });
    expect(created.statusCode).toBe(201);
    const saleId = created.json().id as string;

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { sourceType: "pos_sale", sourceId: saleId, type: "invoice" } });
    const royaltyBefore = await prisma.royaltyEntry.aggregate({ where: { contractId }, _sum: { quantity: true } });
    expect(royaltyBefore._sum.quantity).toBe(3); // vente = +3 exemplaires

    const cancel = await app.inject({
      method: "POST", url: `/api/v1/pos-sales/${saleId}/cancel`, headers: { cookie },
      payload: { reason: "Erreur de saisie (mauvais montant)" },
    });
    expect(cancel.statusCode).toBe(200);
    const creditNoteId = cancel.json().credit_note_id as string;
    expect(creditNoteId).toBeTruthy();

    // Avoir rattaché à la facture d'origine (facture jamais effacée).
    const creditNote = await prisma.invoice.findUniqueOrThrow({ where: { id: creditNoteId } });
    expect(creditNote.type).toBe("credit_note");
    expect(creditNote.parentInvoiceId).toBe(invoice.id);

    // Droits d'auteur contre-passés : le cumul revient à zéro.
    const royaltyAfter = await prisma.royaltyEntry.aggregate({ where: { contractId }, _sum: { quantity: true } });
    expect(royaltyAfter._sum.quantity).toBe(0);

    // Direction financière notifiée (l'avoir + les droits bougent).
    const notif = await prisma.notification.findFirst({ where: { entityType: "invoice", entityId: creditNoteId } });
    expect(notif).not.toBeNull();

    // La vente est marquée annulée (suppression logique), avec son motif.
    const sale = await prisma.posSale.findUniqueOrThrow({ where: { id: saleId } });
    expect(sale.cancelledAt).not.toBeNull();
    expect(sale.cancellationReason).toBe("Erreur de saisie (mauvais montant)");
    expect(sale.cancelledBy).toBe(adminId);

    // Aucun mouvement de stock généré par la vente ni par son annulation.
    const mv = await prisma.stockMovement.findFirst({ where: { referenceType: "pos_sale", referenceId: saleId } });
    expect(mv).toBeNull();
  }, 60000); // 1er test : marge « démarrage à froid » (cf. vitest.config.ts).

  it("refuse une seconde annulation (déjà annulée, 409)", async () => {
    const { isbnId } = await createCatalogueIsbn(`Catalogue ${uniqueIsbnPrefix(2)}`);
    const created = await app.inject({
      method: "POST", url: "/api/v1/pos-sales", headers: { cookie },
      payload: { isbn_id: isbnId, quantity: 1, unit_price: 5000, payment_method: "cash" },
    });
    const saleId = created.json().id as string;
    const first = await app.inject({ method: "POST", url: `/api/v1/pos-sales/${saleId}/cancel`, headers: { cookie }, payload: { reason: "Vente de test" } });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: "POST", url: `/api/v1/pos-sales/${saleId}/cancel`, headers: { cookie }, payload: { reason: "Encore" } });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("already_cancelled");
  });

  it("exige un motif (400 si absent ou vide)", async () => {
    const { isbnId } = await createCatalogueIsbn(`Catalogue ${uniqueIsbnPrefix(2)}`);
    const created = await app.inject({
      method: "POST", url: "/api/v1/pos-sales", headers: { cookie },
      payload: { isbn_id: isbnId, quantity: 1, unit_price: 5000, payment_method: "cash" },
    });
    const saleId = created.json().id as string;
    const noReason = await app.inject({ method: "POST", url: `/api/v1/pos-sales/${saleId}/cancel`, headers: { cookie }, payload: {} });
    expect(noReason.statusCode).toBe(400);
    const blank = await app.inject({ method: "POST", url: `/api/v1/pos-sales/${saleId}/cancel`, headers: { cookie }, payload: { reason: "   " } });
    expect(blank.statusCode).toBe(400);
  });

  it("annule une vente HORS CATALOGUE (provisoire) sans effet comptable", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/pos-sales", headers: { cookie },
      payload: { off_catalogue_title: `Provisoire ${uniqueIsbnPrefix(2)}`, quantity: 2, unit_price: 4000, payment_method: "cash" },
    });
    const saleId = created.json().id as string;
    const cancel = await app.inject({ method: "POST", url: `/api/v1/pos-sales/${saleId}/cancel`, headers: { cookie }, payload: { reason: "Doublon" } });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().credit_note_id).toBeNull(); // pas de facture → pas d'avoir
    const sale = await prisma.posSale.findUniqueOrThrow({ where: { id: saleId } });
    expect(sale.cancelledAt).not.toBeNull();
  });

  it("exclut les ventes annulées du récapitulatif annuel et du total « Mes ventes »", async () => {
    const { isbnId } = await createCatalogueIsbn(`Catalogue ${uniqueIsbnPrefix(2)}`);
    const year = new Date().getUTCFullYear();
    const recapBefore = await app.inject({ method: "GET", url: `/api/v1/commercial/sales-annual?year=${year}`, headers: { cookie } });
    const revenueBefore = recapBefore.json().totals.revenue as number;

    const created = await app.inject({
      method: "POST", url: "/api/v1/pos-sales", headers: { cookie },
      payload: { isbn_id: isbnId, quantity: 5, unit_price: 10000, payment_method: "cash" },
    });
    const saleId = created.json().id as string;

    const recapWith = await app.inject({ method: "GET", url: `/api/v1/commercial/sales-annual?year=${year}`, headers: { cookie } });
    expect(recapWith.json().totals.revenue as number).toBe(revenueBefore + 50000);

    await app.inject({ method: "POST", url: `/api/v1/pos-sales/${saleId}/cancel`, headers: { cookie }, payload: { reason: "Annulée" } });

    const recapAfter = await app.inject({ method: "GET", url: `/api/v1/commercial/sales-annual?year=${year}`, headers: { cookie } });
    // La vente annulée ne compte plus dans le CA.
    expect(recapAfter.json().totals.revenue as number).toBe(revenueBefore);

    // Elle reste visible dans « Mes ventes », marquée annulée.
    const mine = await app.inject({ method: "GET", url: "/api/v1/pos-sales?mine=true", headers: { cookie } });
    const row = (mine.json() as { id: string; cancelled: boolean }[]).find((s) => s.id === saleId);
    expect(row?.cancelled).toBe(true);
  }, 60000);

  it("refuse l'annulation si le mois comptable de la vente est clôturé (409)", async () => {
    // Vente provisoire datée d'un mois passé, que l'on clôture ensuite.
    const pastMonth = new Date(Date.UTC(2000, 0, 15));
    const sale = await prisma.posSale.create({
      data: { isbnId: null, offCatalogueTitle: "Ancienne vente", quantity: 1, unitPrice: 1000, paymentMethod: "cash", soldBy: adminId, soldAt: pastMonth },
    });
    await prisma.accountingPeriod.upsert({
      where: { periodKey: "2000-01" }, update: { status: "closed" }, create: { periodKey: "2000-01", status: "closed" },
    });

    const cancel = await app.inject({ method: "POST", url: `/api/v1/pos-sales/${sale.id}/cancel`, headers: { cookie }, payload: { reason: "Trop tard" } });
    expect(cancel.statusCode).toBe(409);
    expect(cancel.json().code).toBe("accounting_period_closed");

    // Rétablit la période pour ne pas polluer les autres suites.
    await prisma.accountingPeriod.update({ where: { periodKey: "2000-01" }, data: { status: "open" } });
  });
});
