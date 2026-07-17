import { prisma } from "./prisma.js";
import { notifyUsers } from "./notify.js";
import { writeAuditLog } from "./audit.js";
import { periodKeyFor } from "./accountingPeriod.js";

// Signalement de clôture d'activité mensuelle (module RH / paie).
//
// Règle de gestion (décision opérateur du 17/07/2026) : l'activité d'un mois
// CIVIL se clôture le « jour de clôture » du mois suivant — 10 PAR DÉFAUT, mais
// PARAMÉTRABLE par la hiérarchie (ex. le 5, le 6…). Des rappels automatiques
// sont envoyés les DEUX jours précédant l'échéance (jour-2 et jour-1) aux
// responsables (RH, Finance, Direction) pour finaliser la paie à temps —
// présences, absences et variables.
//
// Pas de tâche planifiée dans le projet (cf. JOURNAL_TECHNIQUE) : les rappels
// sont générés PARESSEUSEMENT quand un responsable ouvre l'ERP autour de cette
// date. Un marqueur (payroll_closure_reminders) garantit qu'un même rappel
// n'est jamais envoyé deux fois.

const CLOSURE_DAY_SETTING = "activity_closure_day";
const DEFAULT_CLOSURE_DAY = 10;
// Bornes : au moins le 3 (pour laisser deux jours de rappel valides : jour-2 et
// jour-1) et au plus le 28 (présent dans tous les mois).
const MIN_CLOSURE_DAY = 3;
const MAX_CLOSURE_DAY = 28;

const TARGET_ROLES = ["RESP_RH", "RESP_FINANCE", "DIR_GENERAL"];

const MONTHS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

function clampDay(n: number): number {
  return Math.min(MAX_CLOSURE_DAY, Math.max(MIN_CLOSURE_DAY, Math.round(n)));
}

// Jour de clôture en vigueur (paramétrable). Toute valeur absente/invalide
// retombe sur la valeur par défaut (10).
export async function getClosureDay(): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: CLOSURE_DAY_SETTING } });
  const raw = typeof s?.value === "number" ? s.value : Number(s?.value);
  return Number.isFinite(raw) ? clampDay(raw) : DEFAULT_CLOSURE_DAY;
}

// Les deux jours de rappel = jour-2 et jour-1 (toujours « 1 à 2 jours avant »).
function reminderDaysFor(closureDay: number): number[] {
  return [closureDay - 2, closureDay - 1];
}

function monthLabelFr(periodKey: string): string {
  const [y, m] = periodKey.split("-").map(Number);
  const name = MONTHS_FR[(m ?? 1) - 1] ?? periodKey;
  return `${name} ${y}`;
}

// Clé de période clôturée le jour de clôture du mois de `now` = le mois civil PRÉCÉDENT.
function periodClosingThisMonth(now: Date): string {
  return periodKeyFor(new Date(now.getFullYear(), now.getMonth() - 1, 1));
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Destinataires actifs des rappels (union des rôles cibles, sans doublon).
async function gatherRecipientIds(): Promise<string[]> {
  const rows = await prisma.userRole.findMany({
    where: {
      revokedAt: null,
      role: { code: { in: TARGET_ROLES } },
      user: { status: "active", deletedAt: null },
    },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

function notifyPayload(periodKey: string, closureDay: number, closureMonth: number) {
  const label = monthLabelFr(periodKey);
  const closureDate = `${String(closureDay).padStart(2, "0")}/${String(closureMonth).padStart(2, "0")}`;
  return {
    title: `Clôture d'activité : finalisez la paie de ${label}`,
    body: `L'activité de ${label} sera clôturée le ${closureDate}. Finalisez la paie — présences, absences et variables — avant l'échéance.`,
  };
}

// Enregistre le jour de clôture (paramétrable par la hiérarchie).
export async function setClosureDay(day: number, actor: { id: string; ip?: string | null }): Promise<number> {
  if (!Number.isFinite(day) || day < MIN_CLOSURE_DAY || day > MAX_CLOSURE_DAY) {
    throw new Error(`Le jour de clôture doit être compris entre le ${MIN_CLOSURE_DAY} et le ${MAX_CLOSURE_DAY}.`);
  }
  const value = Math.round(day);
  await prisma.setting.upsert({
    where: { key: CLOSURE_DAY_SETTING },
    update: { value, updatedBy: actor.id },
    create: { key: CLOSURE_DAY_SETTING, value, updatedBy: actor.id },
  });
  await writeAuditLog({
    userId: actor.id,
    action: "update",
    entityType: "activity_closure_config",
    entityId: CLOSURE_DAY_SETTING,
    newValues: { closure_day: value },
    ipAddress: actor.ip ?? null,
  });
  return value;
}

// État affiché par la rubrique « Clôture d'activité » (RH). Décrit la prochaine
// échéance, la période concernée, l'état de clôture et les rappels déjà émis.
export async function activityClosureStatus(now: Date = new Date()) {
  const closureDay = await getClosureDay();
  const day = now.getDate();
  let closureDate: Date;
  let periodKey: string;
  if (day <= closureDay) {
    // L'échéance imminente (le jour de clôture de ce mois) clôture le mois précédent.
    closureDate = new Date(now.getFullYear(), now.getMonth(), closureDay);
    periodKey = periodClosingThisMonth(now);
  } else {
    // Passé l'échéance : la prochaine clôture (mois prochain) portera sur ce mois.
    closureDate = new Date(now.getFullYear(), now.getMonth() + 1, closureDay);
    periodKey = periodKeyFor(new Date(now.getFullYear(), now.getMonth(), 1));
  }

  const [closed, reminders] = await Promise.all([
    prisma.payrollClosure.findUnique({ where: { periodKey } }),
    prisma.payrollClosureReminder.findMany({ where: { periodKey }, orderBy: { sentAt: "desc" } }),
  ]);

  const daysUntil = Math.round((startOfDay(closureDate).getTime() - startOfDay(now).getTime()) / 86_400_000);

  return {
    closure_day: closureDay,
    reminder_days: reminderDaysFor(closureDay),
    period_key: periodKey,
    period_label: monthLabelFr(periodKey),
    closure_date: closureDate.toISOString(),
    days_until_closure: daysUntil,
    is_closed: Boolean(closed),
    closed_at: closed?.closedAt ?? null,
    reminders_sent: reminders.map((r) => ({
      reminder_day: r.reminderDay,
      manual: r.reminderDay === 0,
      sent_at: r.sentAt,
      recipients: r.recipients,
    })),
  };
}

type SweepResult = { sent: boolean; reason?: string; periodKey?: string; recipients?: number };

// Génération paresseuse des rappels automatiques (jour-2 et jour-1). Idempotent :
// un rappel par période et par jour, jamais renvoyé. N'envoie rien si la
// période est déjà clôturée. Au meilleur effort — toute erreur est ignorée par
// l'appelant (fire-and-forget).
export async function sweepClosureReminders(now: Date = new Date()): Promise<SweepResult> {
  const closureDay = await getClosureDay();
  const day = now.getDate();
  if (!reminderDaysFor(closureDay).includes(day)) return { sent: false, reason: "hors_fenetre" };

  const periodKey = periodClosingThisMonth(now);

  const closed = await prisma.payrollClosure.findUnique({ where: { periodKey } });
  if (closed) return { sent: false, reason: "deja_cloturee" };

  const userIds = await gatherRecipientIds();
  if (userIds.length === 0) return { sent: false, reason: "aucun_destinataire" };

  // Marqueur d'abord (contrainte d'unicité) : garantit qu'un seul appel notifie,
  // même si plusieurs responsables ouvrent l'ERP en même temps.
  try {
    await prisma.payrollClosureReminder.create({ data: { periodKey, reminderDay: day, recipients: userIds.length } });
  } catch {
    return { sent: false, reason: "deja_envoye" };
  }

  const payload = notifyPayload(periodKey, closureDay, now.getMonth() + 1);
  await notifyUsers({
    userIds,
    type: "echeance",
    priority: "high",
    title: payload.title,
    body: payload.body,
    entityType: "payroll_closure",
    entityId: periodKey,
    emailOverride: true,
  });

  await writeAuditLog({
    userId: null,
    action: "update",
    entityType: "payroll_closure",
    entityId: periodKey,
    newValues: { reminder: true, auto: true, reminderDay: day, closureDay, recipients: userIds.length },
  });

  return { sent: true, periodKey, recipients: userIds.length };
}

// Envoi manuel du rappel (responsable habilité), hors fenêtre automatique.
// Refuse si la période est déjà clôturée. Journalisé et tracé (jour 0 = manuel).
export async function sendClosureReminderNow(actor: { id: string; ip?: string | null }, now: Date = new Date()) {
  const status = await activityClosureStatus(now);
  if (status.is_closed) {
    throw new Error(`La paie de ${status.period_label} est déjà clôturée : aucun rappel à envoyer.`);
  }
  const userIds = await gatherRecipientIds();
  if (userIds.length === 0) throw new Error("Aucun destinataire (RH, Finance, Direction) disponible.");

  const periodKey = status.period_key;
  const closureMonth = new Date(status.closure_date).getMonth() + 1;

  await prisma.payrollClosureReminder.upsert({
    where: { periodKey_reminderDay: { periodKey, reminderDay: 0 } },
    create: { periodKey, reminderDay: 0, recipients: userIds.length, sentBy: actor.id },
    update: { recipients: userIds.length, sentBy: actor.id, sentAt: new Date() },
  });

  const payload = notifyPayload(periodKey, status.closure_day, closureMonth);
  await notifyUsers({
    userIds,
    type: "echeance",
    priority: "high",
    title: payload.title,
    body: payload.body,
    entityType: "payroll_closure",
    entityId: periodKey,
    emailOverride: true,
  });

  await writeAuditLog({
    userId: actor.id,
    action: "update",
    entityType: "payroll_closure",
    entityId: periodKey,
    newValues: { reminder: true, manual: true, recipients: userIds.length },
    ipAddress: actor.ip ?? null,
  });

  return { periodKey, period_label: status.period_label, recipients: userIds.length };
}
