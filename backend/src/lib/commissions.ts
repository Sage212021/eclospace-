import { prisma } from "./prisma.js";
import type { SalesOrderStatus } from "@prisma/client";
import { writeAuditLog } from "./audit.js";

// Commissions commerciales (demande opérateur) : chaque commercial touche une
// commission sur le montant qu'il a vendu. Taux par défaut 10 %, paramétrable
// par la DAF (finance:administration). Rapports par semaine, mois, semestre ou
// année.
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
  // semaine ISO
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

export interface CommissionAgentRow {
  agent_id: string | null;
  agent_name: string;
  units: number;
  amount: number;
  commission: number;
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

export async function commissions(opts: { from?: Date; to?: Date; granularity: CommissionGranularity }): Promise<CommissionResult> {
  const { from, to, granularity } = opts;
  const rate = await getCommissionRate();

  const [posSales, orders] = await Promise.all([
    prisma.posSale.findMany({
      where: dateWhere("soldAt", from, to),
      select: { soldBy: true, quantity: true, unitPrice: true, soldAt: true },
    }),
    prisma.salesOrder.findMany({
      where: { status: { in: SOLD_ORDER_STATUSES }, ...dateWhere("createdAt", from, to) },
      select: { createdBy: true, createdAt: true, lines: { select: { quantity: true, unitPrice: true, discountPct: true } } },
    }),
  ]);

  // Résolution des noms de commerciaux.
  const ids = new Set<string>();
  for (const s of posSales) if (s.soldBy) ids.add(s.soldBy);
  for (const o of orders) if (o.createdBy) ids.add(o.createdBy);
  const users = ids.size ? await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, username: true } }) : [];
  const nameById = new Map(users.map((u) => [u.id, u.username]));
  const nameOf = (id: string | null) => (id ? (nameById.get(id) ?? id) : "Non attribué");

  const byAgent = new Map<string, { name: string; units: number; amount: number }>();
  const byPeriod = new Map<string, { units: number; amount: number }>();
  const addAgent = (id: string | null, units: number, amount: number) => {
    const key = id ?? "__none__";
    const e = byAgent.get(key) ?? { name: nameOf(id), units: 0, amount: 0 };
    e.units += units;
    e.amount += amount;
    byAgent.set(key, e);
  };
  const addPeriod = (d: Date, units: number, amount: number) => {
    const key = periodKey(d, granularity);
    const e = byPeriod.get(key) ?? { units: 0, amount: 0 };
    e.units += units;
    e.amount += amount;
    byPeriod.set(key, e);
  };

  for (const s of posSales) {
    const amt = s.quantity * Number(s.unitPrice);
    addAgent(s.soldBy, s.quantity, amt);
    addPeriod(s.soldAt, s.quantity, amt);
  }
  for (const o of orders) {
    for (const l of o.lines) {
      const amt = l.quantity * Number(l.unitPrice) * (1 - Number(l.discountPct) / 100);
      addAgent(o.createdBy, l.quantity, amt);
      addPeriod(o.createdAt, l.quantity, amt);
    }
  }

  const by_agent: CommissionAgentRow[] = [...byAgent.entries()]
    .map(([key, e]) => ({ agent_id: key === "__none__" ? null : key, agent_name: e.name, units: e.units, amount: round2(e.amount), commission: round2(e.amount * rate) }))
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
