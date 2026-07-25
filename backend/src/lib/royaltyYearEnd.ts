import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { notifyUsers } from "./notify.js";
import { writeAuditLog } from "./audit.js";
import { assertPeriodOpen } from "./accountingPeriod.js";
import { lastWorkingDayOfMonth } from "./activityClosure.js";
import { authorRoyaltiesByYear } from "./authorRoyalties.js";

type Tx = Prisma.TransactionClient;

// Génération automatique des états annuels de droits d'auteur (demande opérateur).
//
// Principe : en fin d'année, l'état des droits de CHAQUE auteur doit être établi
// et payé — sans que le comptable le demande. Comme pour la clôture d'activité
// (pas de robot serveur, cf. JOURNAL_TECHNIQUE), la génération est PARESSEUSE :
// elle se déclenche, une seule fois, quand un responsable Finance/Direction ouvre
// l'ERP à partir du DERNIER JOUR OUVRABLE de l'année. Un rappel est envoyé les
// deux jours précédant l'échéance. Un marqueur (Setting) garantit l'unicité.
//
// Dissociation par année : la génération couvre une année civile pleine
// (1er janvier → 31 décembre) et le contrôle d'anti-chevauchement empêche de
// mêler deux années — chaque année a son propre état, même en cas de retard.

const TARGET_ROLES = ["RESP_FINANCE", "DIR_GENERAL"];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function lastWorkingDayOfYear(year: number): Promise<Date> {
  return lastWorkingDayOfMonth(year, 11); // décembre
}

// Construit le relevé d'un contrat sur une période (écritures non rattachées,
// amortissement de l'à-valoir restant, solde dû). Logique partagée avec la
// génération manuelle d'un relevé (routes/royalties.ts).
export async function buildContractStatement(
  tx: Tx,
  contract: { id: string; royaltyTerms: { advanceAmount: Prisma.Decimal | null } | null },
  periodStart: Date,
  periodEnd: Date,
  actorId: string | null,
) {
  const entries = await tx.royaltyEntry.findMany({
    where: { contractId: contract.id, statementId: null, computedAt: { gte: periodStart, lt: periodEnd } },
  });
  const totalEarned = entries.reduce((sum, e) => sum + Number(e.amount), 0);

  const priorStatements = await tx.royaltyStatement.aggregate({ where: { contractId: contract.id }, _sum: { advanceRecouped: true } });
  const advanceAmount = Number(contract.royaltyTerms?.advanceAmount ?? 0);
  const alreadyRecouped = Number(priorStatements._sum.advanceRecouped ?? 0);
  const remainingAdvance = Math.max(advanceAmount - alreadyRecouped, 0);
  const advanceRecouped = Math.min(Math.max(totalEarned, 0), remainingAdvance);
  const balanceDue = Math.round((totalEarned - advanceRecouped) * 100) / 100;

  const created = await tx.royaltyStatement.create({
    data: {
      contractId: contract.id,
      periodStart,
      periodEnd,
      totalEarned: Math.round(totalEarned * 100) / 100,
      advanceRecouped: Math.round(advanceRecouped * 100) / 100,
      balanceDue,
      status: "issued",
      createdBy: actorId ?? undefined,
    },
  });
  await tx.royaltyEntry.updateMany({ where: { id: { in: entries.map((e) => e.id) } }, data: { statementId: created.id } });
  return created;
}

// Génère les états annuels d'une année pour tous les contrats ayant des droits
// non encore relevés sur l'année. Idempotent au niveau contrat (anti-chevauchement)
// et sûr à relancer. Renvoie le nombre de relevés créés.
export async function generateYearEndStatements(year: number, actorId: string | null): Promise<number> {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1)); // borne exclusive : 1er janvier suivant

  const rows = await prisma.royaltyEntry.findMany({
    where: { statementId: null, computedAt: { gte: from, lt: to } },
    select: { contractId: true },
    distinct: ["contractId"],
  });
  const contractIds = [...new Set(rows.map((r) => r.contractId))];

  let created = 0;
  for (const cid of contractIds) {
    const contract = await prisma.contract.findUnique({ where: { id: cid }, include: { royaltyTerms: true } });
    if (!contract || !contract.royaltyTerms) continue; // pas de clauses de droits = pas de relevé

    // Anti-chevauchement : ne pas doubler un relevé couvrant déjà cette année.
    const overlapping = await prisma.royaltyStatement.findFirst({
      where: { contractId: cid, periodStart: { lt: to }, periodEnd: { gt: from } },
    });
    if (overlapping) continue;

    try {
      await prisma.$transaction(async (tx) => {
        await assertPeriodOpen(tx);
        await buildContractStatement(tx, contract, from, to, actorId);
      });
      created++;
    } catch {
      // Période comptable close ou course concurrente : au meilleur effort, on saute.
    }
  }

  if (created > 0) {
    await writeAuditLog({
      userId: actorId,
      action: "create",
      entityType: "royalty_year_end",
      entityId: String(year),
      newValues: { year, statementsCreated: created },
    });
  }
  return created;
}

// Échéance de génération : le dernier jour ouvrable de l'année en cours ; les
// rappels tombent deux jours avant.
async function resolveYearClosure(now: Date): Promise<{ year: number; closureDate: Date; reminderDates: Date[] }> {
  const closureDate = await lastWorkingDayOfYear(now.getFullYear());
  return { year: now.getFullYear(), closureDate, reminderDates: [addDays(closureDate, -2), addDays(closureDate, -1)] };
}

const genKey = (year: number) => `royalty_year_generated:${year}`;
const remKey = (year: number, day: number) => `royalty_year_reminder:${year}:${day}`;

// État affiché par la rubrique « États annuels de droits d'auteur » : échéance,
// génération déjà faite ou non, et récapitulatif (auteurs, droits, reste à verser).
export async function royaltyYearEndStatus(now: Date = new Date()) {
  const { year, closureDate, reminderDates } = await resolveYearClosure(now);
  const marker = await prisma.setting.findUnique({ where: { key: genKey(year) } });
  const daysUntil = Math.round((startOfDay(closureDate).getTime() - startOfDay(now).getTime()) / 86_400_000);
  const summary = await authorRoyaltiesByYear({ year });

  const generatedValue = (marker?.value ?? null) as { generatedAt?: string; count?: number } | null;
  return {
    year,
    closure_date: closureDate.toISOString(),
    reminder_days: reminderDates.map((d) => d.getDate()),
    days_until_closure: daysUntil,
    is_generated: Boolean(marker),
    generated_at: generatedValue?.generatedAt ?? null,
    statements_created: generatedValue?.count ?? null,
    authors: summary.by_author.length,
    total_earned: summary.totals.earned,
    total_paid_gross: summary.totals.paid_gross,
    total_remaining: summary.totals.remaining,
  };
}

async function gatherRecipientIds(): Promise<string[]> {
  const rows = await prisma.userRole.findMany({
    where: { revokedAt: null, role: { code: { in: TARGET_ROLES } }, user: { status: "active", deletedAt: null } },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

// Génération/notification « à la connexion », idempotente et au meilleur effort :
//   • dans la fenêtre des deux jours précédant l'échéance → rappel (une fois) ;
//   • à partir de l'échéance, si pas encore généré → génère les états de l'année,
//     verrouillé par un marqueur unique, puis notifie.
export async function sweepRoyaltyYearEnd(now: Date = new Date()): Promise<{ done: boolean; reason?: string; year?: number; created?: number }> {
  const { year, closureDate, reminderDates } = await resolveYearClosure(now);
  const already = await prisma.setting.findUnique({ where: { key: genKey(year) } });
  if (already) return { done: false, reason: "deja_genere", year };

  const atOrAfterClosure = startOfDay(now).getTime() >= startOfDay(closureDate).getTime();

  // Rappel avant l'échéance (jour-2 / jour-1), une seule fois par jour.
  if (!atOrAfterClosure) {
    if (!reminderDates.some((d) => sameDay(d, now))) return { done: false, reason: "hors_fenetre", year };
    try {
      await prisma.setting.create({ data: { key: remKey(year, now.getDate()), value: { sentAt: now.toISOString() } } });
    } catch {
      return { done: false, reason: "rappel_deja_envoye", year };
    }
    const userIds = await gatherRecipientIds();
    if (userIds.length > 0) {
      await notifyUsers({
        userIds,
        type: "echeance",
        priority: "high",
        title: `États de droits d'auteur ${year} : échéance proche`,
        body: `Les états annuels de droits d'auteur ${year} seront générés au dernier jour ouvrable de l'année. Préparez le paiement des auteurs.`,
        entityType: "royalty_year_end",
        entityId: String(year),
        emailOverride: true,
      });
    }
    return { done: true, reason: "rappel", year };
  }

  // Verrou d'unicité : le premier appel gagne, crée le marqueur puis génère.
  try {
    await prisma.setting.create({ data: { key: genKey(year), value: { generatedAt: now.toISOString(), count: 0 } } });
  } catch {
    return { done: false, reason: "course", year };
  }

  const created = await generateYearEndStatements(year, null);
  await prisma.setting.update({ where: { key: genKey(year) }, data: { value: { generatedAt: now.toISOString(), count: created } } });

  const userIds = await gatherRecipientIds();
  if (userIds.length > 0) {
    await notifyUsers({
      userIds,
      type: "echeance",
      priority: "high",
      title: `États de droits d'auteur ${year} générés`,
      body: `Les états annuels de droits d'auteur ${year} ont été générés automatiquement (${created} relevé(s)). Procédez au paiement des auteurs.`,
      entityType: "royalty_year_end",
      entityId: String(year),
      emailOverride: true,
    });
  }
  return { done: true, reason: "genere", year, created };
}
