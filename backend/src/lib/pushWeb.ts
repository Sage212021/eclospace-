import webpush from "web-push";
import { prisma } from "./prisma.js";
import type { NotificationPriority, NotificationType } from "@prisma/client";
import { unreadBadgeCount } from "./badge.js";

// ─────────────────────────────────────────────────────────────────────────────
// Notifications « Web Push » : alerte l'utilisateur sur son téléphone MÊME
// application fermée (bandeau + son, comme une messagerie). Le ciblage n'est
// PAS réinventé ici : on n'envoie qu'aux appareils des `userIds` déjà retenus
// par les notifications nominatives (annonces = à tous, tâches/missions = à la
// personne concernée). Voir `notify.ts`.
//
// Envoi « au meilleur effort » : une panne du service de push ne doit JAMAIS
// interrompre l'opération métier. Toute erreur est journalisée puis ignorée,
// et un abonnement devenu invalide (404/410) est supprimé automatiquement.
// ─────────────────────────────────────────────────────────────────────────────

let configured = false;
try {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:contact@eclosionedition.com";
  if (publicKey && privateKey) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  }
} catch (err) {
  console.error("[push] configuration VAPID invalide :", err);
  configured = false;
}

// Le push est-il activé sur ce serveur ? (clés VAPID présentes)
export function isPushConfigured(): boolean {
  return configured;
}

// Clé publique VAPID, transmise au navigateur pour créer l'abonnement.
export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

export interface PushPayloadInput {
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
}

// Envoi à tous les appareils des utilisateurs visés. La sonnerie suit la
// préférence de chacun (`soundEnabled`) : coupée → notification silencieuse.
export async function sendWebPushToUsers(userIds: string[], input: PushPayloadInput): Promise<void> {
  if (!configured) return; // clés non posées : le badge et la cloche in-app suffisent.
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;

  let subs: {
    id: string;
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    user: { notificationPreference: { soundEnabled: boolean } | null } | null;
  }[];
  try {
    subs = await prisma.pushSubscription.findMany({
      where: { userId: { in: ids } },
      select: {
        id: true,
        userId: true,
        endpoint: true,
        p256dh: true,
        auth: true,
        user: { select: { notificationPreference: { select: { soundEnabled: true } } } },
      },
    });
  } catch (err) {
    console.error("[push] lecture des abonnements impossible :", err);
    return;
  }
  if (subs.length === 0) return;

  // Compteur de non-lus par destinataire (une fois par personne), pour poser le
  // badge de l'icône même application fermée. Au meilleur effort : en cas
  // d'erreur on n'envoie simplement pas de badge.
  const badgeByUser = new Map<string, number>();
  await Promise.all(
    [...new Set(subs.map((s) => s.userId))].map(async (uid) => {
      try {
        badgeByUser.set(uid, await unreadBadgeCount(uid));
      } catch {
        /* pas de badge pour cette personne */
      }
    }),
  );

  await Promise.all(
    subs.map(async (sub) => {
      const silent = sub.user?.notificationPreference?.soundEnabled === false;
      const badge = badgeByUser.get(sub.userId);
      const payload = JSON.stringify({
        title: input.title,
        body: input.body,
        priority: input.priority,
        category: input.type,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        badge: typeof badge === "number" ? badge : undefined,
        silent,
      });
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        await prisma.pushSubscription.update({ where: { id: sub.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        // 404/410 : l'appareil s'est désabonné ou l'adresse a expiré → on purge.
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          console.error(`[push] échec de l'envoi (${statusCode ?? "?"}) :`, (err as Error).message);
        }
      }
    }),
  );
}
