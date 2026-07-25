import { prisma } from "./prisma.js";

// État annuel des droits d'auteur PAR AUTEUR (demande opérateur) : un auteur peut
// avoir plusieurs ouvrages ; on consolide, pour une année civile, ses droits par
// ouvrage (avec le taux appliqué à chaque livre) et on ajoute le récapitulatif
// fiscal de l'année — droits versés bruts, retenue à la source, net — utile à
// l'auteur pour sa déclaration (réglementation camerounaise sur le droit
// d'auteur et la retenue à la source).
//
// Deux bases complémentaires, toutes deux affichées :
//   • droits ACQUIS dans l'année (royalty_entries) : par ouvrage, avec le taux ;
//   • droits VERSÉS dans l'année (royalty_payments) : brut, retenue, net.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface AuthorRoyaltyBook {
  contract_id: string;
  contract_number: string;
  title: string;
  units: number; // quantité nette (ventes moins retours)
  base: number; // assiette (somme base unitaire × quantité)
  rate: number; // taux effectif appliqué à l'ouvrage (fraction, ex. 0.10)
  earned: number; // droits acquis dans l'année
}
export interface AuthorRoyaltyRow {
  partner_id: string;
  author_name: string;
  books: AuthorRoyaltyBook[];
  earned: number; // total droits acquis dans l'année
  paid_gross: number; // droits versés bruts dans l'année
  tax_withheld: number; // retenue à la source dans l'année
  paid_net: number; // net versé dans l'année
}
export interface AuthorRoyaltyResult {
  year: number;
  by_author: AuthorRoyaltyRow[];
  totals: { earned: number; paid_gross: number; tax_withheld: number; paid_net: number };
}

type Book = { contract_id: string; contract_number: string; title: string; units: number; base: number; earned: number };
type Author = { name: string; books: Map<string, Book>; earned: number; paid_gross: number; tax_withheld: number; paid_net: number };

export async function authorRoyaltiesByYear(opts: { year: number; partnerId?: string }): Promise<AuthorRoyaltyResult> {
  const { year, partnerId } = opts;
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));

  const [entries, payments] = await Promise.all([
    prisma.royaltyEntry.findMany({
      where: { computedAt: { gte: from, lt: to }, ...(partnerId ? { contract: { partnerId } } : {}) },
      select: {
        quantity: true,
        unitBaseAmount: true,
        amount: true,
        contract: {
          select: {
            id: true,
            contractNumber: true,
            partnerId: true,
            partner: { select: { firstName: true, lastName: true } },
            manuscript: { select: { title: true } },
          },
        },
      },
    }),
    prisma.royaltyPayment.findMany({
      where: { paidAt: { gte: from, lt: to }, ...(partnerId ? { statement: { contract: { partnerId } } } : {}) },
      select: {
        amount: true,
        taxWithheld: true,
        statement: { select: { contract: { select: { partnerId: true, partner: { select: { firstName: true, lastName: true } } } } } },
      },
    }),
  ]);

  const byAuthor = new Map<string, Author>();
  const ensure = (pid: string, name: string): Author => {
    let a = byAuthor.get(pid);
    if (!a) {
      a = { name, books: new Map(), earned: 0, paid_gross: 0, tax_withheld: 0, paid_net: 0 };
      byAuthor.set(pid, a);
    } else if (a.name === "—" && name !== "—") {
      a.name = name; // complète le nom si un premier passage ne l'avait pas
    }
    return a;
  };

  for (const e of entries) {
    const pid = e.contract.partnerId;
    const name = `${e.contract.partner.firstName} ${e.contract.partner.lastName}`.trim() || "—";
    const a = ensure(pid, name);
    const cid = e.contract.id;
    let b = a.books.get(cid);
    if (!b) {
      b = { contract_id: cid, contract_number: e.contract.contractNumber, title: e.contract.manuscript?.title ?? e.contract.contractNumber, units: 0, base: 0, earned: 0 };
      a.books.set(cid, b);
    }
    b.units += e.quantity;
    b.base += e.quantity * Number(e.unitBaseAmount);
    b.earned += Number(e.amount);
    a.earned += Number(e.amount);
  }

  for (const p of payments) {
    const c = p.statement.contract;
    const name = `${c.partner.firstName} ${c.partner.lastName}`.trim() || "—";
    const a = ensure(c.partnerId, name);
    const net = Number(p.amount);
    const tax = Number(p.taxWithheld);
    a.paid_net += net;
    a.tax_withheld += tax;
    a.paid_gross += net + tax;
  }

  const by_author: AuthorRoyaltyRow[] = [...byAuthor.entries()]
    .map(([partner_id, a]) => ({
      partner_id,
      author_name: a.name,
      books: [...a.books.values()]
        .map((b) => ({
          contract_id: b.contract_id,
          contract_number: b.contract_number,
          title: b.title,
          units: b.units,
          base: round2(b.base),
          rate: b.base > 0 ? Math.round((b.earned / b.base) * 10000) / 10000 : 0,
          earned: round2(b.earned),
        }))
        .sort((x, y) => y.earned - x.earned),
      earned: round2(a.earned),
      paid_gross: round2(a.paid_gross),
      tax_withheld: round2(a.tax_withheld),
      paid_net: round2(a.paid_net),
    }))
    .sort((a, b) => b.earned - a.earned);

  const totals = by_author.reduce(
    (t, r) => ({
      earned: round2(t.earned + r.earned),
      paid_gross: round2(t.paid_gross + r.paid_gross),
      tax_withheld: round2(t.tax_withheld + r.tax_withheld),
      paid_net: round2(t.paid_net + r.paid_net),
    }),
    { earned: 0, paid_gross: 0, tax_withheld: 0, paid_net: 0 },
  );

  return { year, by_author, totals };
}
