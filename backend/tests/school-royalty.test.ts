import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createUserWithRole, extractSessionCookie } from "./helpers.js";

// Droits d'auteur du LIVRE SCOLAIRE : 12 % par défaut quel que soit l'ouvrage,
// modulable (taux maison réglable + taux par ligne), segmenté par ouvrage /
// auteur / co-auteurs / ISBN / prix unitaire (conformité). Calcul déclenché à
// l'établissement de la facture depuis une commande à facturer détaillée.

const PWD = "SchoolRoy123!";
const rnd = () => Math.random().toString(36).slice(2, 7);
function rndIsbn(): string {
  let s = "97";
  for (let i = 0; i < 11; i++) s += Math.floor(Math.random() * 10);
  return s;
}

describe("droits d'auteur du livre scolaire (12 % par défaut, modulable, segmenté)", () => {
  let app: FastifyInstance;
  let admin = "";
  let customerId = "";
  let manuscriptAId = "";
  let manuscriptBId = "";
  let isbnAId = "";
  let isbnBId = "";
  let isbnACode = "";
  let manuscriptCId = "";
  let isbnCId = "";
  let contractCId = "";
  const orderIds: string[] = [];
  const invoiceIds: string[] = [];
  const partnerIds: string[] = [];

  const login = async (u: string, p = PWD) => {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: u, password: p } });
    return extractSessionCookie(r.cookies.map((c) => `${c.name}=${c.value}`));
  };

  beforeAll(async () => {
    app = await buildApp();
    admin = await login("admin", process.env.ADMIN_INITIAL_PASSWORD ?? "TestAdmin123!");

    const customer = await prisma.customer.create({ data: { category: "particulier", name: `Ministère ${rnd()}` } });
    customerId = customer.id;

    const status = await prisma.workflowStatus.findFirstOrThrow({ orderBy: { stepOrder: "asc" } });
    const owner = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });

    const author = await prisma.partner.create({ data: { firstName: "Awa", lastName: `Fofana-${rnd()}`, category: "auteur" } });
    const coAuthor = await prisma.partner.create({ data: { firstName: "Ibrahim", lastName: `Sow-${rnd()}`, category: "auteur" } });
    partnerIds.push(author.id, coAuthor.id);

    const msA = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-SCO-${rnd()}`, title: "Mathématiques 6e", language: "fr", statusId: status.id, ownerId: owner.id, receivedAt: new Date(), editorialSegment: "scolaire" },
    });
    const msB = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-SCO-${rnd()}`, title: "Histoire-Géo 5e", language: "fr", statusId: status.id, ownerId: owner.id, receivedAt: new Date(), editorialSegment: "scolaire" },
    });
    manuscriptAId = msA.id;
    manuscriptBId = msB.id;

    await prisma.workContributor.createMany({
      data: [
        { manuscriptId: msA.id, partnerId: author.id, role: "author", displayOrder: 0 },
        { manuscriptId: msA.id, partnerId: coAuthor.id, role: "co_author", displayOrder: 1 },
        { manuscriptId: msB.id, partnerId: author.id, role: "author", displayOrder: 0 },
      ],
    });

    isbnACode = rndIsbn();
    const isbnA = await prisma.isbn.create({ data: { isbn13: isbnACode, format: "print", manuscriptId: msA.id } });
    const isbnB = await prisma.isbn.create({ data: { isbn13: rndIsbn(), format: "print", manuscriptId: msB.id } });
    isbnAId = isbnA.id;
    isbnBId = isbnB.id;

    // Ouvrage C : livre scolaire disposant EN PLUS d'un contrat d'édition actif
    // (base prix public, taux 8 %). Le contrat doit primer sur le taux maison.
    const msC = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-SCO-${rnd()}`, title: "Sciences 4e", language: "fr", statusId: status.id, ownerId: owner.id, receivedAt: new Date(), editorialSegment: "scolaire" },
    });
    manuscriptCId = msC.id;
    await prisma.workContributor.create({ data: { manuscriptId: msC.id, partnerId: author.id, role: "author", displayOrder: 0 } });
    const isbnC = await prisma.isbn.create({ data: { isbn13: rndIsbn(), format: "print", manuscriptId: msC.id } });
    isbnCId = isbnC.id;
    const contractC = await prisma.contract.create({
      data: {
        contractNumber: `CT-SCO-${rnd()}`,
        type: "edition",
        manuscriptId: msC.id,
        partnerId: author.id,
        formats: ["print"],
        financialTerms: {},
        status: "active",
        royaltyTerms: { create: { base: "prix_public_ht", tiers: [{ up_to: null, rate: 0.08 }] } },
      },
    });
    contractCId = contractC.id;

    // Seuil de validation neutre : les factures restent « émises » (le calcul des
    // droits est indépendant du statut, mais on garde le test lisible).
    await prisma.setting.upsert({ where: { key: "finance.validation_threshold" }, create: { key: "finance.validation_threshold", value: 0 }, update: { value: 0 } });
    // Taux maison par défaut connu.
    await prisma.setting.deleteMany({ where: { key: "royalty.scolaire_default_rate" } });
  });

  afterAll(async () => {
    await prisma.schoolRoyaltyEntry.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.billingOrder.updateMany({ where: { id: { in: orderIds } }, data: { invoiceId: null } });
    await prisma.billingOrderLine.deleteMany({ where: { billingOrderId: { in: orderIds } } });
    await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.billingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.royaltyTerms.deleteMany({ where: { contractId: contractCId } });
    await prisma.contract.deleteMany({ where: { id: contractCId } });
    await prisma.isbn.deleteMany({ where: { id: { in: [isbnAId, isbnBId, isbnCId] } } });
    await prisma.workContributor.deleteMany({ where: { manuscriptId: { in: [manuscriptAId, manuscriptBId, manuscriptCId] } } });
    await prisma.manuscript.deleteMany({ where: { id: { in: [manuscriptAId, manuscriptBId, manuscriptCId] } } });
    await prisma.partner.deleteMany({ where: { id: { in: partnerIds } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.setting.deleteMany({ where: { key: "royalty.scolaire_default_rate" } });
    await app.close();
  });

  async function createDetailedOrder(lines: { isbn_id?: string; description: string; quantity: number; unit_price_ht: number; royalty_rate?: number }[]) {
    const res = await app.inject({ method: "POST", url: "/api/v1/billing-orders", headers: { cookie: admin }, payload: { customer_id: customerId, category: "livre_scolaire", label: `Manuels ${rnd()}`, tax_rate: 0, lines } });
    if (res.statusCode === 201) orderIds.push(res.json().id);
    return res;
  }
  async function invoiceOrder(orderId: string) {
    const res = await app.inject({ method: "POST", url: `/api/v1/billing-orders/${orderId}/invoice`, headers: { cookie: admin } });
    if (res.statusCode === 201) invoiceIds.push(res.json().id);
    return res;
  }

  it("calcule 12 % par défaut, segmenté par ouvrage / auteur / co-auteurs / ISBN / prix unitaire", async () => {
    const create = await createDetailedOrder([
      { isbn_id: isbnAId, description: "Mathématiques 6e", quantity: 100, unit_price_ht: 3000 },
      { isbn_id: isbnBId, description: "Histoire-Géo 5e", quantity: 50, unit_price_ht: 5000, royalty_rate: 0.1 },
    ]);
    expect(create.statusCode).toBe(201);
    // Montant HT dérivé des lignes : 100×3000 + 50×5000 = 550 000.
    expect(create.json().amount_ht).toBe(550000);

    const inv = await invoiceOrder(create.json().id);
    expect(inv.statusCode).toBe(201);

    const entries = await prisma.schoolRoyaltyEntry.findMany({ where: { invoiceId: inv.json().id }, orderBy: { amount: "desc" } });
    expect(entries).toHaveLength(2);

    const math = entries.find((e) => e.manuscriptId === manuscriptAId)!;
    // 12 % par défaut : 100 × 3000 × 0,12 = 36 000.
    expect(Number(math.rateApplied)).toBe(0.12);
    expect(Number(math.baseAmount)).toBe(300000);
    expect(Number(math.amount)).toBe(36000);
    expect(Number(math.unitPriceHt)).toBe(3000);
    expect(math.quantity).toBe(100);
    // Segmentation obligatoire : titre, ISBN, auteur, co-auteurs.
    expect(math.bookTitle).toBe("Mathématiques 6e");
    expect(math.isbnCode).toBe(isbnACode);
    expect(math.authorName).toContain("Awa");
    expect(math.coAuthors.length).toBe(1);
    expect(math.coAuthors[0]).toMatch(/co-auteur/);

    const histo = entries.find((e) => e.manuscriptId === manuscriptBId)!;
    // Taux par ligne (10 %) prime sur le taux maison : 50 × 5000 × 0,10 = 25 000.
    expect(Number(histo.rateApplied)).toBe(0.1);
    expect(Number(histo.amount)).toBe(25000);
    expect(histo.coAuthors.length).toBe(0);
  });

  it("le contrat d'édition prime sur le taux maison ; un taux de ligne prime sur le contrat", async () => {
    const create = await createDetailedOrder([
      // Sans taux de ligne → le contrat (8 %) doit primer sur le taux maison (12 %).
      { isbn_id: isbnCId, description: "Sciences 4e", quantity: 100, unit_price_ht: 4000 },
    ]);
    const inv = await invoiceOrder(create.json().id);
    const entry = await prisma.schoolRoyaltyEntry.findFirstOrThrow({ where: { invoiceId: inv.json().id, manuscriptId: manuscriptCId } });
    // Taux du contrat 8 % : 100 × 4000 × 0,08 = 32 000 (et non 12 % = 48 000).
    expect(Number(entry.rateApplied)).toBe(0.08);
    expect(Number(entry.amount)).toBe(32000);

    // Un taux explicite sur la ligne prime même sur le contrat.
    const create2 = await createDetailedOrder([{ isbn_id: isbnCId, description: "Sciences 4e", quantity: 10, unit_price_ht: 4000, royalty_rate: 0.05 }]);
    const inv2 = await invoiceOrder(create2.json().id);
    const entry2 = await prisma.schoolRoyaltyEntry.findFirstOrThrow({ where: { invoiceId: inv2.json().id, manuscriptId: manuscriptCId } });
    expect(Number(entry2.rateApplied)).toBe(0.05);
    expect(Number(entry2.amount)).toBe(2000); // 10 × 4000 × 0,05
  });

  it("taux maison modulable : la DAF le règle, les nouvelles factures l'appliquent", async () => {
    const set = await app.inject({ method: "PUT", url: "/api/v1/royalties/school-rate", headers: { cookie: admin }, payload: { rate: 0.15 } });
    expect(set.statusCode).toBe(200);
    expect(set.json().rate).toBe(0.15);

    const create = await createDetailedOrder([{ isbn_id: isbnAId, description: "Mathématiques 6e", quantity: 10, unit_price_ht: 3000 }]);
    const inv = await invoiceOrder(create.json().id);
    const entry = await prisma.schoolRoyaltyEntry.findFirstOrThrow({ where: { invoiceId: inv.json().id } });
    // Nouveau taux maison 15 % : 10 × 3000 × 0,15 = 4 500.
    expect(Number(entry.rateApplied)).toBe(0.15);
    expect(Number(entry.amount)).toBe(4500);

    // Remise à 12 % pour la suite du test.
    await app.inject({ method: "PUT", url: "/api/v1/royalties/school-rate", headers: { cookie: admin }, payload: { rate: 0.12 } });
  });

  it("relevé segmenté par ouvrage : quantités, assiette et droits acquis", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/royalties/school", headers: { cookie: admin } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const math = body.by_book.find((b: { manuscript_id: string }) => b.manuscript_id === manuscriptAId);
    expect(math).toBeTruthy();
    expect(math.author_name).toContain("Awa");
    expect(math.isbn_code).toBe(isbnACode);
    // Deux ventes de maths cumulées : 100 (12 %) + 10 (15 %) = 110 exemplaires.
    expect(math.units).toBe(110);
    // Droits maths : 36 000 + 4 500 = 40 500 ; taux mixtes → rate null.
    expect(math.earned).toBe(40500);
    expect(math.rate).toBeNull();
  });

  it("écriture du taux maison réservée à la DAF (finance:administration)", async () => {
    const magU = `sroy_mag_${rnd()}`;
    await createUserWithRole(magU, "MAGASINIER", PWD);
    const magCookie = await login(magU);
    const denied = await app.inject({ method: "PUT", url: "/api/v1/royalties/school-rate", headers: { cookie: magCookie }, payload: { rate: 0.2 } });
    expect(denied.statusCode).toBe(403);
  });

  it("avoir sur une facture scolaire : contre-passe les droits (le relevé se neutralise)", async () => {
    const create = await createDetailedOrder([{ isbn_id: isbnBId, description: "Histoire-Géo 5e", quantity: 20, unit_price_ht: 5000 }]);
    const inv = await invoiceOrder(create.json().id);
    const invoiceId = inv.json().id;

    // Cette facture ajoute 20 × 5000 × 0,12 = 12 000 aux droits cumulés du livre B.
    const earnedOf = async (): Promise<number> => {
      const r = await app.inject({ method: "GET", url: `/api/v1/royalties/school?manuscript_id=${manuscriptBId}`, headers: { cookie: admin } });
      return r.json().by_book.find((b: { manuscript_id: string }) => b.manuscript_id === manuscriptBId)?.earned ?? 0;
    };
    const earnedBefore = await earnedOf();

    const credit = await app.inject({ method: "POST", url: `/api/v1/invoices/${invoiceId}/credit-note`, headers: { cookie: admin }, payload: { reason: "Livraison annulée" } });
    expect(credit.statusCode).toBe(201);
    invoiceIds.push(credit.json().id);

    const earnedAfter = await earnedOf();
    // L'avoir contre-passe exactement les 12 000 de cette facture.
    expect(Math.round((earnedBefore - earnedAfter) * 100) / 100).toBe(12000);
  });
});
