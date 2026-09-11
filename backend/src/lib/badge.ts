import { prisma } from "./prisma.js";

// Nombre total de « non-lus » d'un utilisateur = notifications (cloche) non lues
// + messages de messagerie non lus. C'est la valeur posée sur l'ICÔNE de
// l'application installée (badge PWA), identique au calcul de la barre
// supérieure (TopBar). Sert à mettre à jour ce badge lors d'un envoi « push »,
// pour qu'il reste juste même application fermée.
export async function unreadBadgeCount(userId: string): Promise<number> {
  const [notif, chat] = await Promise.all([
    prisma.notification.count({ where: { userId, readAt: null } }),
    chatUnreadCount(userId),
  ]);
  return notif + chat;
}

async function chatUnreadCount(userId: string): Promise<number> {
  const convs = await prisma.conversation.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true },
  });
  if (convs.length === 0) return 0;
  const reads = await prisma.conversationRead.findMany({
    where: { userId, conversationId: { in: convs.map((c) => c.id) } },
  });
  const readAt = new Map(reads.map((r) => [r.conversationId, r.lastReadAt]));
  return prisma.chatMessage.count({
    where: {
      senderId: { not: userId },
      deletedAt: null,
      OR: convs.map((c) => ({ conversationId: c.id, createdAt: { gt: readAt.get(c.id) ?? new Date(0) } })),
    },
  });
}
