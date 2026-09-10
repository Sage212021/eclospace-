import { prisma } from "./prisma.js";
import { getOrCreateConversation } from "./chat.js";

// « Quoi de neuf » — distribution automatique des notes de version.
//
// À chaque déploiement (le seed du postdeploy l'appelle), toute note NON encore
// distribuée est envoyée comme MESSAGE dans la messagerie interne, de la part de
// l'expéditeur système « Eclospace », à chaque utilisateur du/des pôle(s)
// concerné(s) (et toujours à la Direction générale). L'idempotence repose sur
// `dispatchedAt` : une note n'est distribuée qu'une seule fois, quels que soient
// les redéploiements suivants.

// Compte système expéditeur des « Quoi de neuf » (créé au seed). Le nom d'usage
// s'affiche tel quel comme correspondant dans la messagerie.
export const SYSTEM_SENDER_USERNAME = "Eclospace";

type ReleaseNoteRow = {
  id: string;
  audienceAll: boolean;
  departmentCodes: string[];
  roleCodes: string[];
};

// Utilisateurs concernés par une note : réunion des cibles (tous / pôles / rôles).
async function resolveReleaseAudience(note: ReleaseNoteRow): Promise<string[]> {
  const ids = new Set<string>();

  if (note.audienceAll) {
    const users = await prisma.user.findMany({ where: { status: "active", deletedAt: null }, select: { id: true } });
    for (const u of users) ids.add(u.id);
    return [...ids];
  }

  if (note.departmentCodes.length > 0) {
    const depts = await prisma.department.findMany({ where: { code: { in: note.departmentCodes } }, select: { id: true } });
    if (depts.length > 0) {
      const users = await prisma.user.findMany({
        where: { status: "active", deletedAt: null, employee: { departmentId: { in: depts.map((d) => d.id) } } },
        select: { id: true },
      });
      for (const u of users) ids.add(u.id);
    }
  }

  if (note.roleCodes.length > 0) {
    const roles = await prisma.role.findMany({ where: { code: { in: note.roleCodes } }, select: { id: true } });
    if (roles.length > 0) {
      const urs = await prisma.userRole.findMany({
        where: { revokedAt: null, roleId: { in: roles.map((r) => r.id) }, user: { status: "active", deletedAt: null } },
        select: { userId: true },
      });
      for (const ur of urs) ids.add(ur.userId);
    }
  }

  // La Direction générale reçoit TOUJOURS les nouveautés (demande opérateur) :
  // chaque note ciblée est aussi remise au pôle DG et aux encadrants généraux,
  // pour que la direction ait la vue complète des mises à jour, quel que soit le
  // pôle visé. (Les notes « tous » sont déjà sorties plus haut.)
  const dgDept = await prisma.department.findFirst({ where: { code: "DG" }, select: { id: true } });
  if (dgDept) {
    const dgUsers = await prisma.user.findMany({
      where: { status: "active", deletedAt: null, employee: { departmentId: dgDept.id } },
      select: { id: true },
    });
    for (const u of dgUsers) ids.add(u.id);
  }
  const dgRoles = await prisma.role.findMany({ where: { code: { in: ["ADMIN_GENERAL", "DIR_GENERAL"] } }, select: { id: true } });
  if (dgRoles.length > 0) {
    const urs = await prisma.userRole.findMany({
      where: { revokedAt: null, roleId: { in: dgRoles.map((r) => r.id) }, user: { status: "active", deletedAt: null } },
      select: { userId: true },
    });
    for (const ur of urs) ids.add(ur.userId);
  }

  return [...ids];
}

export async function dispatchReleaseNotes(): Promise<{ notes: number; notifications: number }> {
  const pending = await prisma.releaseNote.findMany({ where: { dispatchedAt: null }, orderBy: { createdAt: "asc" } });
  if (pending.length === 0) return { notes: 0, notifications: 0 };

  // Expéditeur système « Eclospace ». Sans lui, on NE marque PAS les notes
  // distribuées (elles partiront quand le compte existera) — pas de perte.
  const sys = await prisma.user.findUnique({ where: { username: SYSTEM_SENDER_USERNAME }, select: { id: true } });
  if (!sys) return { notes: 0, notifications: 0 };

  let notifications = 0;
  for (const note of pending) {
    const userIds = (await resolveReleaseAudience(note)).filter((id) => id !== sys.id);
    if (userIds.length > 0) {
      const body = `📣 ${note.title}\n\n${note.body}`;
      for (const userId of userIds) {
        // Un message de la part d'Eclospace dans la conversation 1-à-1 avec la
        // personne (créée si besoin). Non-lu tant qu'elle ne l'a pas ouverte.
        const conv = await getOrCreateConversation(sys.id, userId);
        await prisma.chatMessage.create({ data: { conversationId: conv.id, senderId: sys.id, body } });
        await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
      }
      notifications += userIds.length;
    }
    // Marquée distribuée même sans destinataire (base fraîche) : pas de renvoi.
    await prisma.releaseNote.update({ where: { id: note.id }, data: { dispatchedAt: new Date() } });
  }
  return { notes: pending.length, notifications };
}
