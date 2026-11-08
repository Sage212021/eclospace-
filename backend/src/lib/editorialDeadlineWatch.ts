import type { NotificationPriority } from "@prisma/client";
import { prisma } from "./prisma.js";
import { notifyRole, notifyUsers } from "./notify.js";

// Veille AUTOMATIQUE des ÉCHÉANCES ÉDITORIALES (surveillance proactive de SAGE),
// INDÉPENDANTE de toute connexion : au démarrage puis à chaque tick (cf.
// server.ts). Parcourt les TÂCHES planifiées (plannedEnd) non terminées et émet
// UNE alerte par seuil (J-7 / J-3 / J-1 / dépassé) et par date d'échéance, sans
// jamais renvoyer deux fois la même (table EditorialDeadlineAlert, clé
// anti-doublon). Replanifier une tâche (nouvelle plannedEnd) ré-ouvre les
// alertes. Destinataires : le DG (ADMIN_GENERAL, supervision) ET le responsable
// de la tâche (alerte préventive). Ne lève JAMAIS : une panne n'interrompt rien.

const ADMIN_ROLE = "ADMIN_GENERAL";

// Seuils d'échéance, du plus serré au plus large. Priorité → couleur/e-mail.
const DEADLINE_BANDS: { threshold: string; maxDays: number; priority: NotificationPriority; label: string }[] = [
  { threshold: "J-1", maxDays: 1, priority: "high", label: "dans 1 jour" },
  { threshold: "J-3", maxDays: 3, priority: "high", label: "dans 3 jours" },
  { threshold: "J-7", maxDays: 7, priority: "medium", label: "dans 7 jours" },
];
const WATCH_STATUSES = ["non_commencee", "en_cours", "suspendue"] as const;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const dayUtc = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const daysToDue = (due: Date, now: Date) => Math.round((dayUtc(due) - dayUtc(now)) / 86_400_000);

async function fireOnce(
  key: string,
  task: { id: string; manuscriptId: string; assigneeId: string | null },
  threshold: string,
  priority: NotificationPriority,
  title: string,
  body: string,
): Promise<boolean> {
  const exists = await prisma.editorialDeadlineAlert.findUnique({ where: { dedupeKey: key }, select: { id: true } });
  if (exists) return false;
  await prisma.editorialDeadlineAlert.create({ data: { taskId: task.id, manuscriptId: task.manuscriptId, kind: "deadline", threshold, dedupeKey: key } });
  // DG : supervision d'ensemble. Responsable de la tâche : alerte préventive.
  await notifyRole({ roleCode: ADMIN_ROLE, type: "echeance", priority, title, body, entityType: "manuscript", entityId: task.manuscriptId });
  if (task.assigneeId) {
    await notifyUsers({ userIds: [task.assigneeId], type: "echeance", priority, title, body, entityType: "manuscript", entityId: task.manuscriptId }).catch(() => {});
  }
  return true;
}

export async function runEditorialDeadlineWatch(now: Date = new Date()): Promise<{ sent: number }> {
  let sent = 0;
  // On ne charge que les tâches pertinentes : planifiées, échéance au plus tard
  // dans 7 jours (ou déjà dépassée), non terminées, sur un ouvrage non supprimé.
  const horizon = new Date(dayUtc(now) + 7 * 86_400_000);
  const tasks = await prisma.task.findMany({
    where: {
      deletedAt: null,
      plannedEnd: { not: null, lte: horizon },
      status: { in: [...WATCH_STATUSES] },
      manuscript: { deletedAt: null },
    },
    select: {
      id: true, title: true, plannedEnd: true, assigneeId: true, manuscriptId: true,
      manuscript: { select: { title: true, manuscriptNumber: true } },
    },
  });
  for (const t of tasks) {
    try {
      if (!t.plannedEnd) continue;
      const dueKey = isoDay(t.plannedEnd);
      const book = `« ${t.manuscript.title} » (${t.manuscript.manuscriptNumber})`;
      const d = daysToDue(t.plannedEnd, now);
      if (d < 0) {
        const retard = Math.abs(d);
        if (await fireOnce(
          `${t.id}:overdue:${dueKey}`, t, "overdue", "high",
          `Tâche en retard — ${book}`,
          `La tâche « ${t.title} » sur l'ouvrage ${book} était due le ${dueKey} (retard de ${retard} jour${retard > 1 ? "s" : ""}) et n'est pas terminée. À traiter ou à replanifier.`,
        )) sent++;
      } else {
        const band = DEADLINE_BANDS.find((b) => d <= b.maxDays);
        if (band && await fireOnce(
          `${t.id}:${band.threshold}:${dueKey}`, t, band.threshold, band.priority,
          `Échéance proche — ${book}`,
          `La tâche « ${t.title} » sur l'ouvrage ${book} arrive à échéance ${band.label} (le ${dueKey}). Anticipez pour tenir le calendrier.`,
        )) sent++;
      }
    } catch (err) {
      console.error(`[editorial-deadline-watch] échec sur la tâche ${t.id}:`, err);
    }
  }
  return { sent };
}
