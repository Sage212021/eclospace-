import type { AnnouncementPriority, NotificationPriority } from "@prisma/client";
import { prisma } from "./prisma.js";
import { notifyUsers } from "./notify.js";
import { announcementPreview } from "./announcementHtml.js";
import { writeAuditLog } from "./audit.js";
import { emitToUsers } from "./realtime.js";

// Correspondance priorité d'annonce → priorité de notification (cloche + seuil
// e-mail). Urgente/Critique franchissent le seuil d'envoi par e-mail.
export function announcementNotificationPriority(p: AnnouncementPriority): NotificationPriority {
  switch (p) {
    case "critique":
      return "critical";
    case "urgente":
      return "high";
    case "importante":
      return "medium";
    default:
      return "low";
  }
}

type TargetRow = { targetType: string; targetId: string | null };

// Résout l'audience d'une annonce (ensemble d'identifiants d'utilisateurs
// ACTIFS) à partir de ses cibles. « tous » = tout le personnel disposant d'un
// compte actif. Les cibles multiples s'additionnent (union), sans doublon.
export async function resolveAudience(targets: TargetRow[]): Promise<Set<string>> {
  const userIds = new Set<string>();

  if (targets.some((t) => t.targetType === "tous")) {
    const users = await prisma.user.findMany({ where: { status: "active", deletedAt: null }, select: { id: true } });
    for (const u of users) userIds.add(u.id);
    return userIds;
  }

  const departmentIds = targets.filter((t) => t.targetType === "departement" && t.targetId).map((t) => t.targetId!);
  const roleIds = targets.filter((t) => t.targetType === "role" && t.targetId).map((t) => t.targetId!);
  const directUserIds = targets.filter((t) => t.targetType === "utilisateur" && t.targetId).map((t) => t.targetId!);

  if (departmentIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { status: "active", deletedAt: null, employee: { departmentId: { in: departmentIds } } },
      select: { id: true },
    });
    for (const u of users) userIds.add(u.id);
  }
  if (roleIds.length > 0) {
    const userRoles = await prisma.userRole.findMany({
      where: { revokedAt: null, roleId: { in: roleIds }, user: { status: "active", deletedAt: null } },
      select: { userId: true },
    });
    for (const ur of userRoles) userIds.add(ur.userId);
  }
  if (directUserIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: directUserIds }, status: "active", deletedAt: null },
      select: { id: true },
    });
    for (const u of users) userIds.add(u.id);
  }
  return userIds;
}

// Publie une annonce : fige la date de publication, crée un reçu de lecture par
// destinataire, génère les notifications (cloche + e-mail selon la priorité) et
// journalise. Idempotent sur les reçus (skipDuplicates) : republier n'écrase
// aucune lecture déjà enregistrée.
export async function publishAnnouncement(
  announcementId: string,
  actor: { id: string; ip?: string | null },
): Promise<{ recipients: number }> {
  const ann = await prisma.announcement.findUnique({
    where: { id: announcementId },
    include: { targets: true, category: { select: { code: true } } },
  });
  if (!ann || ann.deletedAt) throw new Error("Annonce introuvable.");

  const audience = await resolveAudience(ann.targets);
  const userIds = [...audience];
  const publishedAt = ann.publishedAt ?? new Date();

  await prisma.announcement.update({
    where: { id: announcementId },
    data: { status: "publiee", publishedAt, updatedBy: actor.id },
  });

  if (userIds.length > 0) {
    await prisma.announcementReceipt.createMany({
      data: userIds.map((userId) => ({ announcementId, userId })),
      skipDuplicates: true,
    });

    const preview = announcementPreview(ann.bodyHtml);
    await notifyUsers({
      userIds,
      type: "annonce",
      priority: announcementNotificationPriority(ann.priority),
      title: ann.title,
      body: preview,
      entityType: "announcement",
      entityId: announcementId,
      // Lecture obligatoire : e-mail même si la priorité est basse.
      emailOverride: ann.requireAck,
    });

    // Poussée temps réel aux destinataires connectés (cloche + son + pop-up).
    // Au meilleur effort : les hors-ligne s'appuient sur la notification
    // persistée déjà créée ci-dessus.
    emitToUsers(userIds, "announcement:new", {
      id: announcementId,
      title: ann.title,
      preview,
      priority: ann.priority,
      category: ann.category?.code ?? null,
      require_ack: ann.requireAck,
    });
  }

  await writeAuditLog({
    userId: actor.id,
    action: "status_change",
    entityType: "announcement",
    entityId: announcementId,
    newValues: { status: "publiee", recipients: userIds.length, requireAck: ann.requireAck },
    ipAddress: actor.ip ?? null,
  });

  return { recipients: userIds.length };
}

// Archivage automatique à l'expiration (§ « durée de publication »). Le projet
// n'a pas de tâche planifiée (cf. JOURNAL_TECHNIQUE) : on balaie paresseusement
// les annonces publiées dont la date d'expiration est passée, au fil des
// consultations (fil, gestion, bannière). Journalisé comme action système
// (userId null). Idempotent et borné (peu d'annonces expirent à la fois).
export async function sweepExpiredAnnouncements(): Promise<number> {
  const now = new Date();
  const expired = await prisma.announcement.findMany({
    where: { status: "publiee", deletedAt: null, expiresAt: { not: null, lt: now } },
    select: { id: true },
    take: 200,
  });
  if (expired.length === 0) return 0;

  await prisma.announcement.updateMany({
    where: { id: { in: expired.map((a) => a.id) } },
    data: { status: "archivee" },
  });
  for (const a of expired) {
    await writeAuditLog({
      userId: null,
      action: "status_change",
      entityType: "announcement",
      entityId: a.id,
      newValues: { status: "archivee", auto: true, reason: "expired" },
    });
  }
  return expired.length;
}

// Relance de lecture : re-notifie les destinataires « concernés » d'une annonce
// publiée — ceux qui n'ont pas accusé réception si la lecture est obligatoire,
// sinon ceux qui n'ont pas encore lu. Réutilise la cloche, le temps réel et
// l'e-mail (au meilleur effort). Ne recrée aucun reçu (ils existent déjà).
export async function remindUnread(
  announcementId: string,
  actor: { id: string; ip?: string | null },
): Promise<{ reminded: number }> {
  const ann = await prisma.announcement.findUnique({
    where: { id: announcementId },
    include: { category: { select: { code: true } } },
  });
  if (!ann || ann.deletedAt) throw new Error("Annonce introuvable.");
  if (ann.status !== "publiee") throw new Error("Seule une annonce publiée peut faire l'objet d'une relance.");

  // « Concernés » = pas encore accusé (lecture obligatoire) ou pas encore lu.
  const pending = await prisma.announcementReceipt.findMany({
    where: {
      announcementId,
      ...(ann.requireAck ? { acknowledgedAt: null } : { readAt: null }),
    },
    select: { userId: true },
  });
  const userIds = pending.map((r) => r.userId);
  if (userIds.length === 0) {
    await writeAuditLog({
      userId: actor.id,
      action: "update",
      entityType: "announcement",
      entityId: announcementId,
      newValues: { reminder: true, reminded: 0 },
      ipAddress: actor.ip ?? null,
    });
    return { reminded: 0 };
  }

  const preview = announcementPreview(ann.bodyHtml);
  const reminderTitle = `Rappel : ${ann.title}`;
  await notifyUsers({
    userIds,
    type: "annonce",
    priority: announcementNotificationPriority(ann.priority),
    title: reminderTitle,
    body: preview,
    entityType: "announcement",
    entityId: announcementId,
    emailOverride: ann.requireAck,
  });
  emitToUsers(userIds, "announcement:new", {
    id: announcementId,
    title: reminderTitle,
    preview,
    priority: ann.priority,
    category: ann.category?.code ?? null,
    require_ack: ann.requireAck,
  });

  await writeAuditLog({
    userId: actor.id,
    action: "update",
    entityType: "announcement",
    entityId: announcementId,
    newValues: { reminder: true, reminded: userIds.length },
    ipAddress: actor.ip ?? null,
  });

  return { reminded: userIds.length };
}
