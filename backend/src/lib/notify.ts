import { prisma } from "./prisma.js";
import type { NotificationPriority, NotificationType } from "@prisma/client";
import { isMailConfigured, sendMail } from "./mailer.js";
import { buildNotificationEmail } from "./documentEmail.js";
import { emitToUsers } from "./realtime.js";
import { sendWebPushToUsers } from "./pushWeb.js";

// Priorité interne → priorité d'affichage (toast/sonnerie côté frontend).
const PUSH_PRIORITY: Record<NotificationPriority, "normale" | "importante" | "urgente" | "critique"> = {
  low: "normale",
  medium: "importante",
  high: "urgente",
  critical: "critique",
};

// Pousse la notification en temps réel aux destinataires (son + alerte visible),
// pour qu'un pôle qui reçoit une information d'un autre pôle soit alerté
// immédiatement à son poste — jamais en sourdine (décision opérateur 07/08/2026).
function pushRealtime(userIds: string[], input: { type: NotificationType; priority: NotificationPriority; title: string; body: string; entityType?: string | null; entityId?: string | null }): void {
  emitToUsers(userIds, "notification:new", {
    id: `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: input.title,
    preview: input.body,
    priority: PUSH_PRIORITY[input.priority],
    category: input.type,
    require_ack: false,
  });
}

interface RoleNotificationInput {
  roleCode: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
}

interface UsersNotificationInput {
  userIds: string[];
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  // Force l'envoi e-mail hors du seuil « important/critique » (ex. lecture
  // obligatoire d'une annonce), sous réserve du consentement de l'utilisateur.
  emailOverride?: boolean;
}

// Seuil d'envoi par e-mail : seules les alertes « importantes » et « critiques »
// sont doublées d'un e-mail, pour ne pas noyer les boîtes sous les notifications
// de routine (affectations, échéances courantes). Les notifications restent
// toujours visibles dans la cloche de l'application, quel que soit le niveau.
const EMAIL_PRIORITIES: NotificationPriority[] = ["high", "critical"];

// Envoi des alertes par e-mail (Phase A) — au « meilleur effort » : une panne
// d'e-mail ne doit JAMAIS interrompre l'opération métier qui a déclenché
// l'alerte (vente, BAT, stock…). Toute erreur est journalisée puis ignorée.
async function emailNotification(
  recipients: { email: string | null }[],
  input: { title: string; body: string; priority: NotificationPriority },
  force = false,
): Promise<void> {
  if (!force && !EMAIL_PRIORITIES.includes(input.priority)) return;
  if (!isMailConfigured()) return; // e-mail non configuré : la cloche in-app suffit.

  const addresses = [...new Set(recipients.map((r) => r.email?.trim()).filter((e): e is string => Boolean(e)))];
  if (addresses.length === 0) return;

  const built = buildNotificationEmail(input);
  for (const to of addresses) {
    try {
      await sendMail({ to, subject: built.subject, text: built.text, html: built.html });
    } catch (err) {
      console.error(`[notify] échec de l'envoi de l'alerte à ${to}:`, err);
    }
  }
}

// Diffusion à tous les titulaires actifs d'un rôle (ex. alertes BAT/impression
// à la Direction ou au responsable impression, Ch. 14 §14.10, Ch. 15). Les
// alertes importantes/critiques sont aussi envoyées par e-mail (au meilleur
// effort) à l'adresse professionnelle des destinataires actifs.
export async function notifyRole(input: RoleNotificationInput): Promise<void> {
  const userRoles = await prisma.userRole.findMany({
    where: { revokedAt: null, role: { code: input.roleCode } },
    select: { userId: true, user: { select: { email: true, status: true, deletedAt: true } } },
  });

  const sendByEmail = EMAIL_PRIORITIES.includes(input.priority) && isMailConfigured();

  await prisma.notification.createMany({
    data: userRoles.map((userRole) => ({
      userId: userRole.userId,
      type: input.type,
      priority: input.priority,
      title: input.title,
      body: input.body,
      entityType: input.entityType,
      entityId: input.entityId,
      // Trace honnête du canal réellement utilisé : « email » si l'alerte part
      // aussi par courriel, « in_app » sinon.
      ...(sendByEmail ? { channel: "email" as const, sentAt: new Date() } : {}),
    })),
  });

  // Alerte temps réel (son + pop-up) aux titulaires du rôle — pas en sourdine.
  const roleUserIds = userRoles.map((ur) => ur.userId);
  pushRealtime(roleUserIds, input);
  // Push sur les appareils (téléphone), même application fermée — au meilleur
  // effort, sur les mêmes destinataires que la notification in-app.
  void sendWebPushToUsers(roleUserIds, input).catch(() => {});

  // N'envoie qu'aux comptes actifs, non supprimés (on ne notifie pas par e-mail
  // un compte désactivé ou clos).
  const recipients = userRoles
    .filter((ur) => ur.user?.status === "active" && !ur.user?.deletedAt)
    .map((ur) => ({ email: ur.user?.email ?? null }));
  await emailNotification(recipients, input);
}

// Diffusion à une liste explicite d'utilisateurs (Babillard d'annonces). Crée
// une notification in-app par destinataire — ce qui alimente immédiatement le
// badge de la cloche existante — et double par e-mail selon le seuil de
// priorité (ou `emailOverride`), au meilleur effort, en respectant la
// préférence e-mail de chaque destinataire (opt-out possible).
export async function notifyUsers(input: UsersNotificationInput): Promise<void> {
  const ids = [...new Set(input.userIds)];
  if (ids.length === 0) return;

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, email: true, status: true, deletedAt: true, notificationPreference: { select: { emailEnabled: true } } },
  });

  const wantsEmail = input.emailOverride === true || EMAIL_PRIORITIES.includes(input.priority);
  const sendByEmail = wantsEmail && isMailConfigured();

  await prisma.notification.createMany({
    data: ids.map((userId) => ({
      userId,
      type: input.type,
      priority: input.priority,
      title: input.title,
      body: input.body,
      entityType: input.entityType,
      entityId: input.entityId,
      ...(sendByEmail ? { channel: "email" as const, sentAt: new Date() } : {}),
    })),
  });

  // Alerte temps réel (son + pop-up) à chaque destinataire — pas en sourdine.
  pushRealtime(ids, input);
  // Push sur les appareils (téléphone), même application fermée — au meilleur
  // effort, sur les mêmes destinataires que la notification in-app.
  void sendWebPushToUsers(ids, input).catch(() => {});

  if (!sendByEmail) return;

  // Destinataires actifs, non supprimés, n'ayant pas désactivé l'e-mail (le
  // défaut est activé lorsqu'aucune préférence n'est enregistrée).
  const recipients = users
    .filter((u) => u.status === "active" && !u.deletedAt && u.notificationPreference?.emailEnabled !== false)
    .map((u) => ({ email: u.email }));
  await emailNotification(recipients, input, true);
}
