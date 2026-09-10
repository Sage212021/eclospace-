import { prisma } from "./prisma.js";
import { getOrCreateConversation } from "./chat.js";

// « Quoi de neuf » — distribution automatique des notes de version.
//
// À chaque déploiement (le seed du postdeploy l'appelle), chaque note est
// RÉCONCILIÉE avec son audience : elle est présente dans la messagerie interne,
// de la part de l'expéditeur système « Eclospace », chez CHAQUE personne
// concernée — et RETIRÉE de celles qui l'auraient reçue à tort.
//
// « Concernée » se lit d'abord par l'ACCÈS : une personne dont l'un des rôles
// actifs donne un droit sur le module visé (`permissionModules`). C'est la façon
// dont l'application modélise réellement « qui a accès à quoi » — la plupart des
// comptes n'ayant pas de département, un ciblage par pôle seul laissait passer
// des cas indésirables (un relecteur recevait une note RH). Les ciblages par
// pôle (`departmentCodes`) et par rôle nominatif (`roleCodes`) restent possibles
// en complément. La Direction générale reçoit toujours toutes les nouveautés.

// Compte système expéditeur des « Quoi de neuf » (créé au seed). Le nom d'usage
// s'affiche tel quel comme correspondant dans la messagerie.
export const SYSTEM_SENDER_USERNAME = "Eclospace";

type ReleaseNoteRow = {
  id: string;
  title: string;
  body: string;
  audienceAll: boolean;
  permissionModules: string[];
  departmentCodes: string[];
  roleCodes: string[];
  dispatchedAt: Date | null;
};

// Utilisateurs concernés par une note : réunion des cibles (tous / accès /
// pôles / rôles), plus la Direction générale.
async function resolveReleaseAudience(note: ReleaseNoteRow): Promise<Set<string>> {
  const ids = new Set<string>();

  if (note.audienceAll) {
    const users = await prisma.user.findMany({ where: { status: "active", deletedAt: null }, select: { id: true } });
    for (const u of users) ids.add(u.id);
    return ids;
  }

  // Ciblage par ACCÈS : toute personne dont un rôle actif porte un droit
  // (n'importe quelle action) sur l'un des modules concernés.
  if (note.permissionModules.length > 0) {
    const perms = await prisma.permission.findMany({
      where: { module: { in: note.permissionModules }, deletedAt: null },
      select: { id: true },
    });
    if (perms.length > 0) {
      const rps = await prisma.rolePermission.findMany({
        where: { permissionId: { in: perms.map((p) => p.id) } },
        select: { roleId: true },
      });
      const roleIds = [...new Set(rps.map((r) => r.roleId))];
      if (roleIds.length > 0) {
        const urs = await prisma.userRole.findMany({
          where: { revokedAt: null, roleId: { in: roleIds }, user: { status: "active", deletedAt: null } },
          select: { userId: true },
        });
        for (const ur of urs) ids.add(ur.userId);
      }
    }
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
  // périmètre visé. (Les notes « tous » sont déjà sorties plus haut.)
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

  return ids;
}

// Corps normalisé du message d'une note (sert aussi à retrouver les envois déjà
// faits, pour ne jamais dupliquer et pour retirer les envois à tort).
const noteBody = (note: { title: string; body: string }) => `📣 ${note.title}\n\n${note.body}`;

export async function dispatchReleaseNotes(): Promise<{ notes: number; notifications: number; pruned: number }> {
  const notes = await prisma.releaseNote.findMany({ orderBy: { createdAt: "asc" } });
  if (notes.length === 0) return { notes: 0, notifications: 0, pruned: 0 };

  // Expéditeur système « Eclospace ». Sans lui, on ne fait rien (les notes
  // partiront quand le compte existera) — pas de perte, `dispatched_at` reste nul.
  const sys = await prisma.user.findUnique({ where: { username: SYSTEM_SENDER_USERNAME }, select: { id: true } });
  if (!sys) return { notes: 0, notifications: 0, pruned: 0 };

  let notifications = 0;
  let pruned = 0;
  for (const note of notes) {
    const audience = await resolveReleaseAudience(note);
    audience.delete(sys.id);
    const body = noteBody(note);

    // Envois déjà réalisés de CETTE note (repérés au corps exact, expéditeur
    // système), quel que soit leur état — pour ne pas ré-envoyer ni ressusciter.
    const existing = await prisma.chatMessage.findMany({
      where: { senderId: sys.id, body },
      select: { id: true, deletedAt: true, conversation: { select: { userAId: true, userBId: true } } },
    });
    const deliveredTo = new Map<string, { id: string; deletedAt: Date | null }>();
    for (const m of existing) {
      const recipient = m.conversation.userAId === sys.id ? m.conversation.userBId : m.conversation.userAId;
      // Si plusieurs (ancien doublon), on garde une référence non supprimée en priorité.
      const prev = deliveredTo.get(recipient);
      if (!prev || (prev.deletedAt && !m.deletedAt)) deliveredTo.set(recipient, { id: m.id, deletedAt: m.deletedAt });
    }

    // Retrait : distribuée à une personne NON concernée → suppression logique.
    for (const [recipient, m] of deliveredTo) {
      if (!audience.has(recipient) && !m.deletedAt) {
        await prisma.chatMessage.update({ where: { id: m.id }, data: { deletedAt: new Date(), deletedBy: sys.id } });
        pruned++;
      }
    }

    // Ajout : personne concernée qui n'a jamais reçu la note (aucun envoi, même
    // supprimé) → on la lui remet dans la messagerie.
    for (const recipient of audience) {
      if (deliveredTo.has(recipient)) continue;
      const conv = await getOrCreateConversation(sys.id, recipient);
      await prisma.chatMessage.create({ data: { conversationId: conv.id, senderId: sys.id, body } });
      await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
      notifications++;
    }

    if (!note.dispatchedAt) {
      await prisma.releaseNote.update({ where: { id: note.id }, data: { dispatchedAt: new Date() } });
    }
  }
  return { notes: notes.length, notifications, pruned };
}
