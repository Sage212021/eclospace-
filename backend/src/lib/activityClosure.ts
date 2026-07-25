import { prisma } from "./prisma.js";
import { notifyUsers } from "./notify.js";
import { writeAuditLog } from "./audit.js";
import { periodKeyFor } from "./accountingPeriod.js";
import { resolveSchedule } from "./attendance.js";

// Signalement de clôture d'activité mensuelle (module RH / paie).
//
// Règle de gestion (décision opérateur du 23/07/2026, remplace le « jour de
// clôture » fixe) : l'activité d'un mois CIVIL se clôture le DERNIER JOUR
// OUVRABLE de ce mois. « Ouvrable » = jour travaillé selon l'horaire de la
// maison (work_schedules, lundi→vendredi par défaut) et non férié
// (public_holidays). Des rappels automatiques sont envoyés les DEUX jours
// précédant l'échéance (jour-2 et jour-1) aux responsables (RH, Finance,
// Direction) pour finaliser la paie à temps — présences, absences, variables.
//
// Pas de tâche planifiée dans le projet (cf. JOURNAL_TECHNIQUE) : les rappels
// sont générés PARESSEUSEMENT quand un responsable ouvre l'ERP autour de cette
// date. Un marqueur (payroll_closure_reminders) garantit qu'un même rappel
// n'est jamais envoyé deux fois.

const TARGET_ROLES = ["RESP_RH", "RESP_FINANCE", "DIR_GENERAL"];

const MONTHS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Jour ISO (1 = lundi … 7 = dimanche) d'une date locale.
function isoWeekday(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1;
}

// Dernier jour OUVRABLE d'un mois : le dernier jour du mois qui est travaillé
// selon l'horaire de la maison et non férié. On part de la fin du mois et on
// remonte. Si tout le mois était chômé (cas théorique), on retient le dernier
// jour calendaire pour ne jamais renvoyer de date vide.
export async function lastWorkingDayOfMonth(year: number, monthIndex: number): Promise<Date> {
  const ref = new Date(year, monthIndex, 1); // normalise un éventuel débordement (mois 12…)
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  // Jours ouvrables de la maison (horaire au niveau entreprise, sinon défaut lun→ven).
  const schedule = await resolveSchedule({ onDate: new Date(y, m, 1) });
  const workingDays = schedule.workingDays;

  // Jours fériés du mois (comparés par clé calendaire "YYYY-MM-DD", sans dérive de fuseau).
  const first = `${y}-${pad2(m + 1)}-01`;
  const last = `${y}-${pad2(m + 1)}-${pad2(daysInMonth)}`;
  const holidays = await prisma.publicHoliday.findMany({
    where: { day: { gte: new Date(`${first}T00:00:00.000Z`), lte: new Date(`${last}T00:00:00.000Z`) } },
    select: { day: true },
  });
  const holidaySet = new Set(holidays.map((h) => h.day.toISOString().slice(0, 10)));

  for (let d = daysInMonth; d >= 1; d--) {
    const dt = new Date(y, m, d);
    const key = `${y}-${pad2(m + 1)}-${pad2(d)}`;
    if (workingDays.includes(isoWeekday(dt)) && !holidaySet.has(key)) return dt;
  }
  return new Date(y, m, daysInMonth);
}

// Prochaine échéance à partir de `now` : la clôture du mois courant si elle
// n'est pas encore passée, sinon celle du mois suivant. La période concernée
// est le mois de l'échéance (le dernier jour ouvrable de M clôture M).
async function resolveClosure(now: Date): Promise<{ closureDate: Date; periodKey: string; reminderDates: Date[] }> {
  const lwdThis = await lastWorkingDayOfMonth(now.getFullYear(), now.getMonth());
  const closureDate =
    startOfDay(now).getTime() <= startOfDay(lwdThis).getTime()
      ? lwdThis
      : await lastWorkingDayOfMonth(now.getFullYear(), now.getMonth() + 1);
  const periodKey = periodKeyFor(new Date(closureDate.getFullYear(), closureDate.getMonth(), 1));
  const reminderDates = [addDays(closureDate, -2), addDays(closureDate, -1)];
  return { closureDate, periodKey, reminderDates };
}

function monthLabelFr(periodKey: string): string {
  const [y, m] = periodKey.split("-").map(Number);
  const name = MONTHS_FR[(m ?? 1) - 1] ?? periodKey;
  return `${name} ${y}`;
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

function notifyPayload(periodKey: string, closureDate: Date) {
  const label = monthLabelFr(periodKey);
  const dateStr = `${pad2(closureDate.getDate())}/${pad2(closureDate.getMonth() + 1)}`;
  return {
    title: `Clôture d'activité : finalisez la paie de ${label}`,
    body: `L'activité de ${label} sera clôturée le ${dateStr} (dernier jour ouvrable du mois). Finalisez la paie — présences, absences et variables — avant l'échéance.`,
  };
}

// État affiché par la rubrique « Clôture d'activité » (RH). Décrit la prochaine
// échéance (dernier jour ouvrable du mois), la période concernée, l'état de
// clôture et les rappels déjà émis.
export async function activityClosureStatus(now: Date = new Date()) {
  const { closureDate, periodKey, reminderDates } = await resolveClosure(now);

  const [closed, reminders] = await Promise.all([
    prisma.payrollClosure.findUnique({ where: { periodKey } }),
    prisma.payrollClosureReminder.findMany({ where: { periodKey }, orderBy: { sentAt: "desc" } }),
  ]);

  const daysUntil = Math.round((startOfDay(closureDate).getTime() - startOfDay(now).getTime()) / 86_400_000);

  return {
    closure_day: closureDate.getDate(),
    reminder_days: reminderDates.map((d) => d.getDate()),
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
  const { closureDate, periodKey, reminderDates } = await resolveClosure(now);
  if (!reminderDates.some((d) => sameDay(d, now))) return { sent: false, reason: "hors_fenetre" };

  const closed = await prisma.payrollClosure.findUnique({ where: { periodKey } });
  if (closed) return { sent: false, reason: "deja_cloturee" };

  const userIds = await gatherRecipientIds();
  if (userIds.length === 0) return { sent: false, reason: "aucun_destinataire" };

  // Marqueur d'abord (contrainte d'unicité) : garantit qu'un seul appel notifie,
  // même si plusieurs responsables ouvrent l'ERP en même temps.
  try {
    await prisma.payrollClosureReminder.create({ data: { periodKey, reminderDay: now.getDate(), recipients: userIds.length } });
  } catch {
    return { sent: false, reason: "deja_envoye" };
  }

  const payload = notifyPayload(periodKey, closureDate);
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
    newValues: { reminder: true, auto: true, reminderDay: now.getDate(), closureDay: closureDate.getDate(), recipients: userIds.length },
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
  const closureDate = new Date(status.closure_date);

  await prisma.payrollClosureReminder.upsert({
    where: { periodKey_reminderDay: { periodKey, reminderDay: 0 } },
    create: { periodKey, reminderDay: 0, recipients: userIds.length, sentBy: actor.id },
    update: { recipients: userIds.length, sentBy: actor.id, sentAt: new Date() },
  });

  const payload = notifyPayload(periodKey, closureDate);
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
