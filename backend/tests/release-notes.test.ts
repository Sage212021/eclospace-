import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { dispatchReleaseNotes, SYSTEM_SENDER_USERNAME } from "../src/lib/releaseNotes.js";

// « Quoi de neuf » : à chaque mise à jour, les utilisateurs du pôle concerné
// reçoivent un MESSAGE dans la messagerie interne, de la part d'« Eclospace » —
// automatiquement, une seule fois.

const rnd = () => Math.random().toString(36).slice(2, 8);

describe("notes de version — distribution en messagerie (expéditeur Eclospace)", () => {
  const tag = rnd();
  let userId: string;
  let employeeId: string;
  let noteId: string;

  afterAll(async () => {
    if (userId) {
      const convs = await prisma.conversation.findMany({ where: { OR: [{ userAId: userId }, { userBId: userId }] }, select: { id: true } });
      const ids = convs.map((c) => c.id);
      await prisma.chatMessage.deleteMany({ where: { conversationId: { in: ids } } });
      await prisma.conversationRead.deleteMany({ where: { conversationId: { in: ids } } });
      await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.releaseNote.deleteMany({ where: { id: noteId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (employeeId) await prisma.employee.deleteMany({ where: { id: employeeId } });
    await prisma.$disconnect();
  });

  it("envoie une note au pôle ciblé comme message d'Eclospace, une seule fois", async () => {
    const rh = await prisma.department.findFirstOrThrow({ where: { code: "RH" } });
    const emp = await prisma.employee.create({ data: { firstName: "Rel", lastName: `Note${tag}`, departmentId: rh.id } });
    employeeId = emp.id;
    const user = await prisma.user.create({
      data: { username: `rel-${tag}`, email: `rel-${tag}@example.com`, passwordHash: "x", status: "active", employeeId: emp.id },
    });
    userId = user.id;
    const sys = await prisma.user.findUniqueOrThrow({ where: { username: SYSTEM_SENDER_USERNAME } });

    const note = await prisma.releaseNote.create({
      data: { slug: `test-${tag}`, version: "test", title: "Nouveauté RH (test)", body: `Le pôle RH a été amélioré. (test-${tag}-marker)`, departmentCodes: ["RH"] },
    });
    noteId = note.id;
    expect(note.dispatchedAt).toBeNull();

    // 1er déploiement : l'utilisateur du pôle RH reçoit un message d'Eclospace.
    const res1 = await dispatchReleaseNotes();
    expect(res1.notes).toBeGreaterThanOrEqual(1);

    // On cible la note DE CE TEST (le pôle RH reçoit aussi les notes RH du seed,
    // désormais réconciliées à chaque déploiement — comportement voulu).
    const where = { senderId: sys.id, body: { contains: `test-${tag}-marker` }, conversation: { OR: [{ userAId: userId }, { userBId: userId }] } };
    const msgs = await prisma.chatMessage.findMany({ where });
    expect(msgs.length).toBe(1);
    expect(msgs[0].body).toContain("Nouveauté RH");
    // La note est marquée distribuée.
    expect((await prisma.releaseNote.findUniqueOrThrow({ where: { id: noteId } })).dispatchedAt).not.toBeNull();

    // 2ᵉ déploiement (le seed rejoue) : AUCUN doublon.
    await dispatchReleaseNotes();
    const after = await prisma.chatMessage.count({ where });
    expect(after).toBe(1);
  });
});
