import type { NotificationPriority, TaskStatus } from "@prisma/client";
import { prisma } from "./prisma.js";
import { notifyUsers } from "./notify.js";

// MESSAGERIE PROACTIVE DE SAGE → DIRECTION GÉNÉRALE. SAGE n'attend plus que le
// DG l'interroge : il peut lui ÉCRIRE de lui-même dans un fil dédié de l'espace
// « Échanger avec SAGE » (« SAGE — Suivi éditorial »), et une notification
// prévient le DG. Le DG peut répondre dans ce fil comme dans n'importe quelle
// conversation (SAGE répond alors normalement). Reste en LECTURE SEULE sur le
// système : SAGE informe et propose, il n'exécute aucune action (gouvernance).

const SAGE_DG_ROLES = ["ADMIN_GENERAL", "DIR_GENERAL"];
const SAGE_CHANNEL_KIND = "sage_direction";
const SAGE_CHANNEL_TITLE = "SAGE — Suivi éditorial";

const dayUtc = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// Identifiants des DG/administrateurs actifs (destinataires des messages de SAGE).
async function directionUserIds(): Promise<string[]> {
  const roles = await prisma.userRole.findMany({
    where: { revokedAt: null, role: { code: { in: SAGE_DG_ROLES } }, user: { status: "active", deletedAt: null } },
    select: { userId: true },
  });
  return [...new Set(roles.map((r) => r.userId))];
}

// Fil dédié « SAGE — Suivi éditorial » du DG (créé à la première utilisation).
async function getOrCreateChannel(ownerId: string): Promise<{ id: string }> {
  const existing = await prisma.aiConversation.findFirst({ where: { ownerId, kind: SAGE_CHANNEL_KIND, archivedAt: null }, select: { id: true } });
  if (existing) return existing;
  return prisma.aiConversation.create({ data: { ownerId, kind: SAGE_CHANNEL_KIND, title: SAGE_CHANNEL_TITLE }, select: { id: true } });
}

// SAGE écrit un message à la Direction (capacité générique, réutilisable). Poste
// un message « assistant » dans le fil dédié de chaque DG et le notifie. Avec
// `onlyIfNoneSince`, n'écrit pas s'il a déjà écrit depuis cette date (anti-spam).
// Ne lève jamais : une panne n'interrompt rien.
export async function sageMessageToDirection(input: {
  content: string;
  notifyTitle: string;
  notifyBody: string;
  priority?: NotificationPriority;
  onlyIfNoneSince?: Date;
}): Promise<{ posted: number }> {
  let posted = 0;
  const priority = input.priority ?? "medium";
  const owners = await directionUserIds();
  for (const ownerId of owners) {
    try {
      const conv = await getOrCreateChannel(ownerId);
      if (input.onlyIfNoneSince) {
        const recent = await prisma.aiConversationMessage.findFirst({
          where: { conversationId: conv.id, role: "assistant", deletedAt: null, createdAt: { gte: input.onlyIfNoneSince } },
          select: { id: true },
        });
        if (recent) continue; // SAGE a déjà écrit sur la période : on n'insiste pas.
      }
      await prisma.aiConversationMessage.create({ data: { conversationId: conv.id, role: "assistant", status: "done", content: input.content } });
      await prisma.aiConversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
      await notifyUsers({ userIds: [ownerId], type: "autre", priority, title: input.notifyTitle, body: input.notifyBody, entityType: "ai_conversation", entityId: conv.id }).catch(() => {});
      posted++;
    } catch (err) {
      console.error(`[sage-direction] échec d'écriture au DG ${ownerId}:`, err);
    }
  }
  return { posted };
}

const BRIEF_STATUSES: TaskStatus[] = ["non_commencee", "en_cours", "suspendue"];
type BriefTask = { title: string; plannedEnd: Date | null; manuscript: { title: string; manuscriptNumber: string } };
const book = (t: BriefTask) => `« ${t.manuscript.title} » (${t.manuscript.manuscriptNumber})`;

// POINT DE SITUATION proactif de SAGE au DG (surveillance → message). Au plus
// UNE fois par jour (anti-spam). Composé à partir des données RÉELLES (tâches en
// retard et échéances à 7 jours) ; aucune date ni difficulté inventée. Si rien
// n'est à signaler, SAGE n'écrit pas (pas de bruit). Ne lève jamais.
export async function runDirectionBrief(now: Date = new Date()): Promise<{ posted: number }> {
  const startToday = new Date(dayUtc(now));
  const horizon = new Date(dayUtc(now) + 7 * 86_400_000);
  const briefSelect = { title: true, plannedEnd: true, manuscript: { select: { title: true, manuscriptNumber: true } } } as const;

  const [overdue, upcoming] = await Promise.all([
    prisma.task.findMany({ where: { deletedAt: null, status: { in: BRIEF_STATUSES }, manuscript: { deletedAt: null }, plannedEnd: { lt: startToday } }, orderBy: { plannedEnd: "asc" }, take: 50, select: briefSelect }),
    prisma.task.findMany({ where: { deletedAt: null, status: { in: BRIEF_STATUSES }, manuscript: { deletedAt: null }, plannedEnd: { gte: startToday, lte: horizon } }, orderBy: { plannedEnd: "asc" }, take: 50, select: briefSelect }),
  ]);
  if (overdue.length === 0 && upcoming.length === 0) return { posted: 0 };

  const lines: string[] = [];
  lines.push(`Point de situation éditorial — ${isoDay(now)}.`);
  lines.push(`${overdue.length} tâche(s) en retard, ${upcoming.length} échéance(s) dans les sept jours.`);
  if (overdue.length) {
    lines.push("", "En retard :");
    for (const t of overdue.slice(0, 8)) {
      const retard = t.plannedEnd ? Math.round((dayUtc(startToday) - dayUtc(t.plannedEnd)) / 86_400_000) : 0;
      lines.push(`- « ${t.title} » — ${book(t)}, due le ${t.plannedEnd ? isoDay(t.plannedEnd) : "?"} (retard de ${retard} j).`);
    }
    if (overdue.length > 8) lines.push(`… et ${overdue.length - 8} autre(s).`);
  }
  if (upcoming.length) {
    lines.push("", "À venir (7 jours) :");
    for (const t of upcoming.slice(0, 8)) lines.push(`- « ${t.title} » — ${book(t)}, le ${t.plannedEnd ? isoDay(t.plannedEnd) : "?"}.`);
    if (upcoming.length > 8) lines.push(`… et ${upcoming.length - 8} autre(s).`);
  }
  lines.push("", "Je reste à disposition si vous voulez que je priorise ou que j'analyse un dossier en particulier.");

  return sageMessageToDirection({
    content: lines.join("\n"),
    notifyTitle: "SAGE — point de situation éditorial",
    notifyBody: `${overdue.length} tâche(s) en retard, ${upcoming.length} échéance(s) à 7 jours.`,
    priority: overdue.length ? "high" : "medium",
    onlyIfNoneSince: startToday,
  });
}
