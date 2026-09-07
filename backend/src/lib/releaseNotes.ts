import { prisma } from "./prisma.js";

// « Quoi de neuf » — distribution automatique des notes de version.
//
// À chaque déploiement (le seed du postdeploy l'appelle), toute note NON encore
// distribuée génère une notification (la cloche) pour chaque utilisateur du/des
// pôle(s) concerné(s). L'idempotence repose sur `dispatchedAt` : une note n'est
// distribuée qu'une seule fois, quels que soient les redéploiements suivants.

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

  return [...ids];
}

export async function dispatchReleaseNotes(): Promise<{ notes: number; notifications: number }> {
  const pending = await prisma.releaseNote.findMany({ where: { dispatchedAt: null }, orderBy: { createdAt: "asc" } });
  let notifications = 0;
  for (const note of pending) {
    const userIds = await resolveReleaseAudience(note);
    if (userIds.length > 0) {
      // Visible ~30 jours dans la cloche (comme un « Quoi de neuf » transitoire),
      // au-delà de la fenêtre par défaut de 24 h des notifications ordinaires.
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await prisma.notification.createMany({
        data: userIds.map((userId) => ({
          userId,
          type: "annonce" as const,
          priority: "medium" as const,
          title: note.title,
          body: note.body,
          entityType: "release_note",
          entityId: note.id,
          expiresAt,
        })),
      });
      notifications += userIds.length;
    }
    // Marquée distribuée même sans destinataire (base fraîche) : pas de renvoi.
    await prisma.releaseNote.update({ where: { id: note.id }, data: { dispatchedAt: new Date() } });
  }
  return { notes: pending.length, notifications };
}
