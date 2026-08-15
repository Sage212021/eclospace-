import { prisma } from "./prisma.js";
import { notifyRole } from "./notify.js";

// Échéances & alertes de contrats.
//
// L'échéance d'un contrat d'édition se déduit de sa date d'effet + sa durée
// (pas de champ dédié). Le modèle maison prévoit une reconduction tacite sauf
// dénonciation par lettre recommandée adressée AU PLUS TARD 3 MOIS avant le
// terme (art. 5 du contrat). La date réellement actionnable est donc le
// « préavis de non-reconduction » = échéance − 3 mois : passé ce jour, il est
// trop tard pour empêcher la reconduction. Ces fonctions servent à la fois au
// tableau de bord (affichage) et à l'alerte proactive de la Direction.

// Fenêtre d'attention (jours) : un contrat est signalé quand il arrive à terme
// dans les 90 jours (soit environ la borne du préavis de 3 mois) ou est échu.
export const CONTRACT_ALERT_WINDOW_DAYS = 90;
// Seuil de bascule en gravité « critique » (jours avant l'échéance).
export const CONTRACT_CRITICAL_DAYS = 30;
const NOTICE_MONTHS = 3; // préavis de non-reconduction (art. 5)
const DAY_MS = 86400000;

export type ContractDeadlineLevel = "critique" | "attention";

// Échéance = date d'effet + durée (mois). Null si l'un manque.
export function contractExpiry(effectiveAt: Date | null | undefined, durationMonths: number | null | undefined): Date | null {
  if (!effectiveAt || !durationMonths) return null;
  const expiry = new Date(effectiveAt);
  expiry.setMonth(expiry.getMonth() + durationMonths);
  return expiry;
}

// Date limite d'envoi du préavis de non-reconduction = échéance − 3 mois.
export function renewalNoticeDeadline(expiry: Date): Date {
  const d = new Date(expiry);
  d.setMonth(d.getMonth() - NOTICE_MONTHS);
  return d;
}

export interface ContractDeadline {
  id: string;
  contract_number: string;
  title: string | null;
  partner_name: string;
  status: string;
  expiry: string; // AAAA-MM-JJ
  renewal_notice_deadline: string; // AAAA-MM-JJ
  days_left: number; // avant l'échéance (négatif si échu)
  notice_days_left: number; // avant la date limite de préavis (négatif si dépassée)
  overdue: boolean; // échéance dépassée
  notice_passed: boolean; // date limite de préavis dépassée
  level: ContractDeadlineLevel;
}

// Construit la ligne d'échéance d'un contrat actif, ou null s'il n'est pas dans
// la fenêtre d'attention (ni échu).
export function buildContractDeadline(
  c: { id: string; contractNumber: string; status: string; effectiveAt: Date | null; durationMonths: number | null; manuscript: { title: string | null } | null; partner: { firstName: string | null; lastName: string | null } },
  now: Date = new Date(),
): ContractDeadline | null {
  if (c.status !== "active") return null;
  const expiry = contractExpiry(c.effectiveAt, c.durationMonths);
  if (!expiry) return null;
  const soon = new Date(now.getTime() + CONTRACT_ALERT_WINDOW_DAYS * DAY_MS);
  if (expiry > soon) return null; // pas encore dans la fenêtre

  const notice = renewalNoticeDeadline(expiry);
  const daysLeft = Math.round((expiry.getTime() - now.getTime()) / DAY_MS);
  const noticeDaysLeft = Math.round((notice.getTime() - now.getTime()) / DAY_MS);
  const overdue = expiry < now;
  const level: ContractDeadlineLevel = overdue || daysLeft <= CONTRACT_CRITICAL_DAYS ? "critique" : "attention";
  return {
    id: c.id,
    contract_number: c.contractNumber,
    title: c.manuscript?.title ?? null,
    partner_name: `${c.partner.firstName ?? ""} ${c.partner.lastName ?? ""}`.trim(),
    status: c.status,
    expiry: expiry.toISOString().slice(0, 10),
    renewal_notice_deadline: notice.toISOString().slice(0, 10),
    days_left: daysLeft,
    notice_days_left: noticeDaysLeft,
    overdue,
    notice_passed: notice < now,
    level,
  };
}

// Récupère tous les contrats actifs et renvoie ceux dans la fenêtre d'attention,
// triés du plus urgent au moins urgent.
export async function listContractDeadlines(now: Date = new Date()): Promise<ContractDeadline[]> {
  const contracts = await prisma.contract.findMany({
    where: { deletedAt: null, status: "active" },
    include: { partner: { select: { firstName: true, lastName: true } }, manuscript: { select: { title: true } } },
  });
  const rows = contracts.map((c) => buildContractDeadline(c, now)).filter((r): r is ContractDeadline => r !== null);
  rows.sort((a, b) => a.days_left - b.days_left);
  return rows;
}

// Alerte proactive de la Direction pour les contrats arrivant à terme. Une seule
// alerte par contrat et par cycle (dédup via renewal_alert_sent_at) — remise à
// zéro quand les termes changent. Renvoie le nombre d'alertes nouvellement
// émises. Best-effort : appelée à l'ouverture du tableau de bord (pas de tâche
// planifiée dans cet hébergement) et via une route manuelle.
export async function runContractDeadlineAlerts(now: Date = new Date()): Promise<number> {
  const contracts = await prisma.contract.findMany({
    where: { deletedAt: null, status: "active", renewalAlertSentAt: null },
    include: { partner: { select: { firstName: true, lastName: true } }, manuscript: { select: { title: true } } },
  });

  let created = 0;
  for (const c of contracts) {
    const d = buildContractDeadline(c, now);
    if (!d) continue; // hors fenêtre : ne pas alerter, ne pas marquer
    const ouvrage = d.title ? `« ${d.title} »` : `contrat ${d.contract_number}`;
    const quand = d.overdue
      ? `est ÉCHU depuis ${Math.abs(d.days_left)} jour(s)`
      : `arrive à échéance le ${d.expiry} (dans ${d.days_left} jour(s))`;
    const preavis = d.notice_passed
      ? `Le préavis de non-reconduction (3 mois avant le terme) est DÉPASSÉ depuis le ${d.renewal_notice_deadline}.`
      : `Préavis de non-reconduction à envoyer au plus tard le ${d.renewal_notice_deadline}.`;
    await notifyRole({
      roleCode: "DIR_GENERAL",
      type: "echeance",
      priority: d.level === "critique" ? "high" : "medium",
      title: `Échéance de contrat — ${d.partner_name || d.contract_number}`,
      body: `Le contrat ${c.contractNumber} (${ouvrage}, auteur ${d.partner_name}) ${quand}. ${preavis}`,
      entityType: "contract",
      entityId: c.id,
    });
    await prisma.contract.update({ where: { id: c.id }, data: { renewalAlertSentAt: now } });
    created += 1;
  }
  return created;
}
