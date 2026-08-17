import { prisma } from "./prisma.js";
import type { StockMovementType, SalesOrderStatus } from "@prisma/client";

// Suivi des ventes par ouvrage (demande opérateur) : pour chaque ouvrage,
// comparer les EXEMPLAIRES SORTIS du stock aux VENTES réellement enregistrées
// (et leur montant encaissé), l'écart (GAP) révélant les sorties non vendues
// (exemplaires gratuits : auteur, presse, pilon ; ou dépôt-vente pas encore
// converti en vente). Découpage par semaine ou par mois.
//
// Définitions retenues :
//  • Sortis  = mouvements de stock sortants (vente, dépôt-vente, exemplaire
//    auteur, service de presse, pilon).
//  • Vendus / Montant = ventes réellement enregistrées et valorisées : ventes
//    au point de vente (pos_sales) + lignes de commandes engagées (hors
//    brouillon / bloquées / annulées).
//  • Écart (GAP) = Sortis − Vendus.

const OUTFLOW_TYPES: StockMovementType[] = ["sale_out", "consignment_out", "author_copy", "press_copy", "pulping"];
// Statuts de commande qui comptent comme une vente engagée (on exclut brouillon,
// crédit bloqué et annulée).
const SOLD_ORDER_STATUSES: SalesOrderStatus[] = ["confirmed", "preparing", "shipped", "delivered", "invoiced"];

export type Granularity = "week" | "month";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Clé de période d'une date selon la granularité. Semaine ISO (lundi→dimanche).
function periodKey(d: Date, g: Granularity): string {
  if (g === "month") return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  // Numéro de semaine ISO 8601.
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7; // dimanche = 7
  date.setUTCDate(date.getUTCDate() + 4 - day); // jeudi de la semaine
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-S${pad2(week)}`;
}

type Bucket = { unitsOut: number; unitsSold: number; amount: number };
function empty(): Bucket {
  return { unitsOut: 0, unitsSold: 0, amount: 0 };
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface SalesTrackingRow {
  key: string; // isbn_id ou clé de période
  label: string; // titre de l'ouvrage ou libellé de période
  units_out: number;
  units_sold: number;
  amount: number;
  gap: number;
}

export interface SalesTrackingResult {
  granularity: Granularity;
  from: string | null;
  to: string | null;
  by_book: SalesTrackingRow[];
  by_period: SalesTrackingRow[];
  totals: { units_out: number; units_sold: number; amount: number; gap: number };
}

function dateWhere(field: string, from?: Date, to?: Date) {
  const f: Record<string, Date> = {};
  if (from) f.gte = from;
  if (to) f.lte = to;
  return Object.keys(f).length ? { [field]: f } : {};
}

export async function salesByBook(opts: { from?: Date; to?: Date; granularity: Granularity }): Promise<SalesTrackingResult> {
  const { from, to, granularity } = opts;

  const [movements, posSales, orders] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { type: { in: OUTFLOW_TYPES }, status: "completed", ...dateWhere("movedAt", from, to) },
      select: { isbnId: true, quantity: true, movedAt: true, isbn: { select: { isbn13: true, manuscript: { select: { title: true } } } } },
    }),
    prisma.posSale.findMany({
      // Ventes annulées exclues du rapprochement Sortis/Vendus (elles ne sont
      // plus des ventes ; le stock, lui, reste piloté par les mouvements magasin).
      where: { ...dateWhere("soldAt", from, to), cancelledAt: null },
      select: { isbnId: true, quantity: true, unitPrice: true, soldAt: true, isbn: { select: { isbn13: true, manuscript: { select: { title: true } } } } },
    }),
    prisma.salesOrder.findMany({
      where: { status: { in: SOLD_ORDER_STATUSES }, ...dateWhere("createdAt", from, to) },
      select: {
        createdAt: true,
        lines: { select: { isbnId: true, quantity: true, unitPrice: true, discountPct: true, isbn: { select: { isbn13: true, manuscript: { select: { title: true } } } } } },
      },
    }),
  ]);

  const byBook = new Map<string, Bucket & { label: string }>();
  const byPeriod = new Map<string, Bucket>();
  const bookOf = (isbnId: string, label: string) => {
    let b = byBook.get(isbnId);
    if (!b) { b = { ...empty(), label }; byBook.set(isbnId, b); }
    return b;
  };
  const periodOf = (d: Date) => {
    const k = periodKey(d, granularity);
    let b = byPeriod.get(k);
    if (!b) { b = empty(); byPeriod.set(k, b); }
    return b;
  };
  const title = (isbn: { isbn13: string; manuscript: { title: string } | null } | null) =>
    isbn?.manuscript?.title ?? isbn?.isbn13 ?? "—";

  for (const m of movements) {
    const b = bookOf(m.isbnId, title(m.isbn));
    b.unitsOut += m.quantity;
    periodOf(m.movedAt).unitsOut += m.quantity;
  }
  for (const s of posSales) {
    if (!s.isbnId) continue; // vente hors catalogue provisoire : hors ventilation par ouvrage
    const amt = s.quantity * Number(s.unitPrice);
    const b = bookOf(s.isbnId, title(s.isbn));
    b.unitsSold += s.quantity;
    b.amount += amt;
    const p = periodOf(s.soldAt);
    p.unitsSold += s.quantity;
    p.amount += amt;
  }
  for (const o of orders) {
    for (const l of o.lines) {
      const amt = l.quantity * Number(l.unitPrice) * (1 - Number(l.discountPct) / 100);
      const b = bookOf(l.isbnId, title(l.isbn));
      b.unitsSold += l.quantity;
      b.amount += amt;
      const p = periodOf(o.createdAt);
      p.unitsSold += l.quantity;
      p.amount += amt;
    }
  }

  const by_book: SalesTrackingRow[] = [...byBook.entries()]
    .map(([key, b]) => ({ key, label: b.label, units_out: b.unitsOut, units_sold: b.unitsSold, amount: round2(b.amount), gap: b.unitsOut - b.unitsSold }))
    .sort((a, b) => b.amount - a.amount || b.units_out - a.units_out);

  const by_period: SalesTrackingRow[] = [...byPeriod.entries()]
    .map(([key, b]) => ({ key, label: key, units_out: b.unitsOut, units_sold: b.unitsSold, amount: round2(b.amount), gap: b.unitsOut - b.unitsSold }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const totals = by_book.reduce(
    (t, r) => ({ units_out: t.units_out + r.units_out, units_sold: t.units_sold + r.units_sold, amount: round2(t.amount + r.amount), gap: t.gap + r.gap }),
    { units_out: 0, units_sold: 0, amount: 0, gap: 0 },
  );

  return {
    granularity,
    from: from ? from.toISOString() : null,
    to: to ? to.toISOString() : null,
    by_book,
    by_period,
    totals,
  };
}
