import { prisma } from "./prisma.js";

// Messagerie interne 1-à-1. Une conversation est identifiée par la PAIRE
// normalisée (userAId < userBId) : quel que soit l'initiateur, on retombe sur la
// même conversation, sans doublon.

export function normalizePair(u1: string, u2: string): [string, string] {
  return u1 < u2 ? [u1, u2] : [u2, u1];
}

export async function getOrCreateConversation(me: string, other: string) {
  const [a, b] = normalizePair(me, other);
  const existing = await prisma.conversation.findUnique({ where: { userAId_userBId: { userAId: a, userBId: b } } });
  if (existing) return existing;
  return prisma.conversation.create({ data: { userAId: a, userBId: b } });
}

// Le « correspondant » d'une conversation vu par `me` (l'autre participant).
export function otherOf(conv: { userAId: string; userBId: string }, me: string): string {
  return conv.userAId === me ? conv.userBId : conv.userAId;
}

export function isParticipant(conv: { userAId: string; userBId: string }, userId: string): boolean {
  return conv.userAId === userId || conv.userBId === userId;
}
