import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { dispatchReleaseNotes, SYSTEM_SENDER_USERNAME } from "../src/lib/releaseNotes.js";
import { getOrCreateConversation } from "../src/lib/chat.js";
import { createUserWithRole } from "./helpers.js";

// « Quoi de neuf » : la note doit atteindre les personnes qui ont l'ACCÈS au
// module concerné (et non un profil sans rapport). Un relecteur (CORRECTEUR)
// ne doit PAS recevoir une note RH ; le responsable RH, oui. Et une note
// distribuée à tort à un profil non concerné est RETIRÉE (suppression logique).

const rnd = () => Math.random().toString(36).slice(2, 8);

async function systemId() {
  return (await prisma.user.findUniqueOrThrow({ where: { username: SYSTEM_SENDER_USERNAME } })).id;
}

async function noteMessagesFor(sysId: string, userId: string, bodyContains: string) {
  return prisma.chatMessage.findMany({
    where: { senderId: sysId, body: { contains: bodyContains }, conversation: { OR: [{ userAId: userId }, { userBId: userId }] } },
  });
}

describe("notes de version — ciblage par accès (pas de fuite hors périmètre)", () => {
  const tag = rnd();
  const relecteurName = `rel_acces_${tag}`;
  const rhName = `rh_acces_${tag}`;
  let noteId: string;
  let relecteurId: string;
  let rhId: string;

  afterAll(async () => {
    for (const uid of [relecteurId, rhId]) {
      if (!uid) continue;
      const convs = await prisma.conversation.findMany({ where: { OR: [{ userAId: uid }, { userBId: uid }] }, select: { id: true } });
      const ids = convs.map((c) => c.id);
      await prisma.chatMessage.deleteMany({ where: { conversationId: { in: ids } } });
      await prisma.conversationRead.deleteMany({ where: { conversationId: { in: ids } } });
      await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
    }
    if (noteId) await prisma.releaseNote.deleteMany({ where: { id: noteId } });
    await prisma.userRole.deleteMany({ where: { user: { username: { in: [relecteurName, rhName] } } } });
    await prisma.user.deleteMany({ where: { username: { in: [relecteurName, rhName] } } });
    await prisma.$disconnect();
  });

  it("livre au responsable RH, jamais au relecteur, et retire un envoi à tort", async () => {
    const sysId = await systemId();
    // Deux profils SANS département (le cas courant) : seul l'accès les distingue.
    relecteurId = (await createUserWithRole(relecteurName, "CORRECTEUR", "Acces123!")).id;
    rhId = (await createUserWithRole(rhName, "RESP_RH", "Acces123!")).id;

    const marker = `RH-ACCES-${tag}`;
    const note = await prisma.releaseNote.create({
      data: {
        slug: `acces-${tag}`,
        version: "test",
        title: `Nouveauté RH ${marker}`,
        body: "Réservée aux personnes ayant accès au module RH.",
        permissionModules: ["rh"],
        departmentCodes: [],
      },
    });
    noteId = note.id;

    // Simule un envoi ANTÉRIEUR à tort au relecteur (cas « Bertrand Relecteur »),
    // avec un ANCIEN corps de texte (le texte de la note a été retouché depuis) :
    // seul le titre est stable. Le nettoyage doit quand même le retirer.
    const ancienCorps = `📣 ${note.title}\n\nAncienne formulation (texte modifié depuis).`;
    const conv = await getOrCreateConversation(sysId, relecteurId);
    const wrong = await prisma.chatMessage.create({ data: { conversationId: conv.id, senderId: sysId, body: ancienCorps } });
    expect(wrong.deletedAt).toBeNull();

    await dispatchReleaseNotes();

    // Le relecteur (CORRECTEUR, aucun droit RH) : l'envoi à tort est RETIRÉ.
    const relMsgs = await noteMessagesFor(sysId, relecteurId, marker);
    expect(relMsgs.length).toBe(1);
    expect(relMsgs[0].deletedAt).not.toBeNull(); // supprimé logiquement
    expect(relMsgs[0].deletedBy).toBe(sysId);

    // Le responsable RH (accès rh, sans département) : il reçoit bien la note.
    const rhMsgs = await noteMessagesFor(sysId, rhId, marker);
    const rhLive = rhMsgs.filter((m) => !m.deletedAt);
    expect(rhLive.length).toBe(1);

    // Idempotence : un 2ᵉ déploiement ne ré-envoie pas, ne re-supprime pas,
    // et ne ressuscite pas l'envoi retiré.
    await dispatchReleaseNotes();
    const rhAfter = (await noteMessagesFor(sysId, rhId, marker)).filter((m) => !m.deletedAt);
    expect(rhAfter.length).toBe(1);
    const relAfter = await noteMessagesFor(sysId, relecteurId, marker);
    expect(relAfter.length).toBe(1);
    expect(relAfter.every((m) => m.deletedAt)).toBe(true);
  });
});
