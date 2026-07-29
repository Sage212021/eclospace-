import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { commercialIndicators } from "../src/lib/kpi.js";

// Régression (demande opérateur du 29/07/2026) : une prestation « compte
// d'auteur » (facture issue d'un devis éditorial) ne doit PAS gonfler les
// indicateurs commerciaux du tableau de bord Direction — seules les vraies
// ventes de livres (comptoir, livraison, dépôt-vente, commande à facturer)
// comptent. C'est ce qui avait fait « disparaître/apparaître » des ventes quand
// un devis de test était établi puis réinitialisé.

const rnd = () => Math.random().toString(36).slice(2, 8);

describe("indicateurs commerciaux : exclusion des prestations devis", () => {
  let customerId: string;
  const createdInvoiceIds: string[] = [];

  beforeAll(async () => {
    const customer = await prisma.customer.create({ data: { category: "librairie", name: `Client KPI ${rnd()}` } });
    customerId = customer.id;
  });

  afterAll(async () => {
    await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    await prisma.customer.delete({ where: { id: customerId } });
    await prisma.$disconnect();
  });

  async function makeInvoice(sourceType: string, amount: number) {
    const inv = await prisma.invoice.create({
      data: {
        invoiceNumber: `TST-${rnd()}`,
        type: "invoice",
        customerId,
        sourceType,
        sourceId: rnd(),
        totalHt: amount,
        totalTax: 0,
        totalTtc: amount,
        status: "issued",
        lines: { create: [{ description: "test", quantity: 1, unitPrice: amount, taxRate: 0, lineTotal: amount }] },
      },
    });
    createdInvoiceIds.push(inv.id);
    return inv;
  }

  it("une prestation (editorial_quote) ne compte pas ; une vente comptoir (pos_sale) compte", async () => {
    const before = await commercialIndicators();

    // Prestation éditoriale de 104 001 : ne doit rien changer côté commercial.
    await makeInvoice("editorial_quote", 104001);
    const afterPresta = await commercialIndicators();
    expect(afterPresta.revenue_total).toBeCloseTo(before.revenue_total, 2);
    expect(afterPresta.units_sold).toBe(before.units_sold);

    // Vraie vente au comptoir de 5 000 : doit augmenter le chiffre d'affaires.
    await makeInvoice("pos_sale", 5000);
    const afterSale = await commercialIndicators();
    expect(afterSale.revenue_total).toBeCloseTo(before.revenue_total + 5000, 2);
    expect(afterSale.units_sold).toBe(before.units_sold + 1);
  });
});
