import { prisma } from "./prisma.js";
import type { SalesOrderStatus } from "@prisma/client";
import { writeAuditLog } from "./audit.js";

// Commissions commerciales (demande opérateur) : chaque commercial touche une
// commission sur le montant qu'il a vendu. Taux par défaut 10 %, paramétrable
// par la DAF (finance:administration). Rapports par semaine, mois, semestre ou
// année. Détail justificatif : par commercial ET par ouvrage.
//
// « Commercial » = l'auteur de la vente : vendeur au point de vente
// (pos_sales.sold_by) ou créateur de la commande (sales_orders.created_by).

const RATE_KEY = "commission_rate";
const DEFAULT_RATE = 0.1; // 10 %
const SOLD_ORDER_STATUSES: SalesOrderStatus[] = ["confirmed", "preparing", "shipped", "delivered", "invoiced"];

export type CommissionGranularity = "week" | "month" | "semester" | "year";

// Taux de commission en vigueur (fraction, ex. 0.10). Toute valeur absente ou
// hors ]0 ; 1] retombe sur 10 %.
export async function getCommissionRate(): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: RATE_KEY } });
  const raw = typeof s?.value === "number" ? s.value : Number(s?.value);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : DEFAULT_RATE;
}

export async function setCommissionRate(rate: number, actor: { id: string; ip?: string | null }): Promise<number> {
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) {
    throw new Error("Le taux de commission doit être compris entre 0 et 100 % (ex. 0,10 pour 10 %).");
  }
  await prisma.setting.upsert({
    where: { key: RATE_KEY },
    update: { value: rate, updatedBy: actor.id },
    create: { key: RATE_KEY, value: rate, updatedBy: actor.id },
  });
  await writeAuditLog({
    userId: actor.id,
    action: "update",
    entityType: "commission_rate",
    entityId: RATE_KEY,
    newValues: { rate },
    ipAddress: actor.ip ?? null,
  });
  return rate;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function periodKey(d: Date, g: CommissionGranularity): string {
  const y = d.getFullYear();
  if (g === "year") return `${y}`;
  if (g === "semester") return d.getMonth() < 6 ? `${y}-Sem1` : `${y}-Sem2`;
  if (g === "month") return `${y}-${pad2(d.getMonth() + 1)}`;
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-S${pad2(week)}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function dateWhere(field: string, from?: Date, to?: Date) {
  const f: Record<string, Date> = {};
  if (from) f.gte = from;
  if (to) f.lte = to;
  return Object.keys(f).length ? { [field]: f } : {};
}

export interface CommissionBookRow {
  isbn_id: string;
  title: string;
  units: number;
  amount: number;
  commission: number;
}
export interface CommissionAgentRow {
  agent_id: string | null;
  agent_name: string;
  units: number;
  amount: number;
  commission: number;
  books: CommissionBookRow[]; // détail justificatif par ouvrage
}
export interface CommissionPeriodRow {
  period: string;
  units: number;
  amount: number;
  commission: number;
}
export interface CommissionResult {
  rate: number;
  granularity: CommissionGranularity;
  by_agent: CommissionAgentRow[];
  by_period: CommissionPeriodRow[];
  totals: { units: number; amount: number; commission: number };
}

type Book = { title: string; units: number; amount: number };
type Agent = { name: string; units: number; amount: number; books: Map<string, Book> };

export async function commissions(opts: { from?: Date; to?: Date; granularity: CommissionGranularity }): Promise<CommissionResult> {
  const { from, to, granularity } = opts;
  const rate = await getCommissionRate();

  const isbnSel = { select: { isbn13: true, manuscript: { select: { title: true } } } };
  const [posSales, orders] = await Promise.all([
    prisma.posSale.findMany({
      where: dateWhere("soldAt", from, to),
      select: { soldBy: true, isbnId: true, quantity: true, unitPrice: true, soldAt: true, isbn: isbnSel },
    }),
    prisma.salesOrder.findMany({
      where: { status: { in: SOLD_ORDER_STATUSES }, ...dateWhere("createdAt", from, to) },
      select: { createdBy: true, createdAt: true, lines: { select: { isbnId: true, quantity: true, unitPrice: true, discountPct: true, isbn: isbnSel } } },
    }),
  ]);

  const ids = new Set<string>();
  for (const s of posSales) if (s.soldBy) ids.add(s.soldBy);
  for (const o of orders) if (o.createdBy) ids.add(o.createdBy);
  const users = ids.size ? await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, username: true } }) : [];
  const nameById = new Map(users.map((u) => [u.id, u.username]));
  const nameOf = (id: string | null) => (id ? (nameById.get(id) ?? id) : "Non attribué");
  const titleOf = (isbn: { isbn13: string; manuscript: { title: string } | null } | null) => isbn?.manuscript?.title ?? isbn?.isbn13 ?? "—";

  const byAgent = new Map<string, Agent>();
  const byPeriod = new Map<string, { units: number; amount: number }>();

  const add = (agentId: string | null, isbnId: string, title: string, when: Date, units: number, amount: number) => {
    const aKey = agentId ?? "__none__";
    let a = byAgent.get(aKey);
    if (!a) { a = { name: nameOf(agentId), units: 0, amount: 0, books: new Map() }; byAgent.set(aKey, a); }
    a.units += units;
    a.amount += amount;
    let bk = a.books.get(isbnId);
    if (!bk) { bk = { title, units: 0, amount: 0 }; a.books.set(isbnId, bk); }
    bk.units += units;
    bk.amount += amount;
    const pKey = periodKey(when, granularity);
    let p = byPeriod.get(pKey);
    if (!p) { p = { units: 0, amount: 0 }; byPeriod.set(pKey, p); }
    p.units += units;
    p.amount += amount;
  };

  for (const s of posSales) add(s.soldBy, s.isbnId, titleOf(s.isbn), s.soldAt, s.quantity, s.quantity * Number(s.unitPrice));
  for (const o of orders) {
    for (const l of o.lines) {
      add(o.createdBy, l.isbnId, titleOf(l.isbn), o.createdAt, l.quantity, l.quantity * Number(l.unitPrice) * (1 - Number(l.discountPct) / 100));
    }
  }

  const by_agent: CommissionAgentRow[] = [...byAgent.entries()]
    .map(([key, a]) => ({
      agent_id: key === "__none__" ? null : key,
      agent_name: a.name,
      units: a.units,
      amount: round2(a.amount),
      commission: round2(a.amount * rate),
      books: [...a.books.entries()]
        .map(([isbn_id, b]) => ({ isbn_id, title: b.title, units: b.units, amount: round2(b.amount), commission: round2(b.amount * rate) }))
        .sort((x, y) => y.commission - x.commission),
    }))
    .sort((a, b) => b.commission - a.commission);

  const by_period: CommissionPeriodRow[] = [...byPeriod.entries()]
    .map(([period, e]) => ({ period, units: e.units, amount: round2(e.amount), commission: round2(e.amount * rate) }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const totals = by_agent.reduce(
    (t, r) => ({ units: t.units + r.units, amount: round2(t.amount + r.amount), commission: round2(t.commission + r.commission) }),
    { units: 0, amount: 0, commission: 0 },
  );

  return { rate, granularity, by_agent, by_period, totals };
}
