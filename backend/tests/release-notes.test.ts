import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { dispatchReleaseNotes } from "../src/lib/releaseNotes.js";

// « Quoi de neuf » : à chaque mise à jour, les utilisateurs du pôle concerné
// reçoivent une notification explicative — automatiquement, une seule fois.

const rnd = () => Math.random().toString(36).slice(2, 8);

describe("notes de version — distribution aux pôles concernés", () => {
  const tag = rnd();
  let userId: string;
  let employeeId: string;
  let noteId: string;

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { entityType: "release_note", entityId: noteId } });
    await prisma.releaseNote.deleteMany({ where: { id: noteId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (employeeId) await prisma.employee.deleteMany({ where: { id: employeeId } });
    await prisma.$disconnect();
  });

  it("distribue une note au pôle ciblé, une seule fois, sans doublon au redéploiement", async () => {
    const rh = await prisma.department.findFirstOrThrow({ where: { code: "RH" } });
    const emp = await prisma.employee.create({ data: { firstName: "Rel", lastName: `Note${tag}`, departmentId: rh.id } });
    employeeId = emp.id;
    const user = await prisma.user.create({
      data: { username: `rel-${tag}`, email: `rel-${tag}@example.com`, passwordHash: "x", status: "active", employeeId: emp.id },
    });
    userId = user.id;

    const note = await prisma.releaseNote.create({
      data: { slug: `test-${tag}`, version: "test", title: "Nouveauté RH (test)", body: "Le pôle RH a été amélioré.", departmentCodes: ["RH"] },
    });
    noteId = note.id;
    expect(note.dispatchedAt).toBeNull();

    // 1er déploiement : l'utilisateur du pôle RH reçoit la notification.
    const res1 = await dispatchReleaseNotes();
    expect(res1.notes).toBeGreaterThanOrEqual(1);
    const mine = await prisma.notification.findMany({ where: { userId, entityType: "release_note", entityId: noteId } });
    expect(mine.length).toBe(1);
    expect(mine[0].type).toBe("annonce");
    expect(mine[0].title).toContain("Nouveauté RH");
    // La note est marquée distribuée.
    expect((await prisma.releaseNote.findUniqueOrThrow({ where: { id: noteId } })).dispatchedAt).not.toBeNull();

    // 2ᵉ déploiement (le seed rejoue) : AUCUN doublon.
    await dispatchReleaseNotes();
    const after = await prisma.notification.count({ where: { userId, entityType: "release_note", entityId: noteId } });
    expect(after).toBe(1);
  });
});
