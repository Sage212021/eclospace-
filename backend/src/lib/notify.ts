import { prisma } from "./prisma.js";
import type { NotificationPriority, NotificationType } from "@prisma/client";
import { isMailConfigured, sendMail } from "./mailer.js";
import { buildNotificationEmail } from "./documentEmail.js";

interface RoleNotificationInput {
  roleCode: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
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
): Promise<void> {
  if (!EMAIL_PRIORITIES.includes(input.priority)) return;
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

  // N'envoie qu'aux comptes actifs, non supprimés (on ne notifie pas par e-mail
  // un compte désactivé ou clos).
  const recipients = userRoles
    .filter((ur) => ur.user?.status === "active" && !ur.user?.deletedAt)
    .map((ur) => ({ email: ur.user?.email ?? null }));
  await emailNotification(recipients, input);
}
