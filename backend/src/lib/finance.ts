import { prisma } from "./prisma.js";

// Solde dû par facture = total TTC − allocations reçues ; encours client
// (Ch. 17 §17.3, §17.5) = somme des soldes dus, factures uniquement (les
// avoirs réduisent directement le solde de la facture d'origine s'ils y
// sont rattachés, sinon ils sont soustraits globalement).
export async function computeCustomerOutstandingBalance(customerId: string): Promise<number> {
  const invoices = await prisma.invoice.findMany({
    where: { customerId, type: "invoice", status: { not: "cancelled" } },
    include: { paymentAllocations: true, creditNotes: true },
  });
  return invoices.reduce((sum, invoice) => {
    const allocated = invoice.paymentAllocations.reduce((s, a) => s + Number(a.amount), 0);
    const credited = invoice.creditNotes.reduce((s, c) => s + Number(c.totalTtc), 0);
    const due = Number(invoice.totalTtc) - allocated - credited;
    return sum + Math.max(due, 0);
  }, 0);
}
