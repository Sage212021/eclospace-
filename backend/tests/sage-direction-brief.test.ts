import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { runDirectionBrief, sageMessageToDirection } from "../src/lib/sageDirection.js";

// SAGE écrit de lui-même au DG : fil dédié « SAGE — Suivi éditorial » +
// notification. Point de situation proactif à partir des données réelles,
// au plus une fois par jour (anti-spam).

const rnd = () => Math.random().toString(36).slice(2, 7);
// Le message posté porte l'horodatage RÉEL (now() en base) : on raisonne donc
// sur « aujourd'hui » réel (seul ce fichier déclenche des points de situation,
// l'anti-doublon du jour n'entre pas en conflit avec un autre test).
const NOW = new Date();
const atDay = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000);
const startToday = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()));

describe("SAGE écrit au DG (messagerie proactive)", () => {
  let adminId: string;
  let statusId: string;

  beforeAll(async () => {
    await buildApp();
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    statusId = (await prisma.workflowStatus.findFirstOrThrow({ where: { code: "CORRECTION" } })).id;
    // Repart d'un fil SAGE propre (la base de dev peut conserver un point du jour
    // d'une exécution précédente, ce qui fausserait l'anti-doublon).
    const convs = await prisma.aiConversation.findMany({ where: { ownerId: adminId, kind: "sage_direction" }, select: { id: true } });
    const ids = convs.map((c) => c.id);
    if (ids.length) {
      await prisma.aiConversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
      await prisma.aiConversation.deleteMany({ where: { id: { in: ids } } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const mkOverdueTask = async () => {
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-BRIEF-${rnd()}`, title: `Brief ${rnd()}`, statusId, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    await prisma.task.create({ data: { manuscriptId: m.id, title: "Correction éditoriale", type: "correction", plannedEnd: atDay(-2), status: "en_cours", createdBy: adminId, updatedBy: adminId } });
  };

  it("poste un point de situation dans le fil dédié et notifie le DG, une seule fois par jour", async () => {
    await mkOverdueTask(); // garantit au moins une tâche en retard
    const beforeNotif = await prisma.notification.count({ where: { userId: adminId, entityType: "ai_conversation" } });

    const r1 = await runDirectionBrief(NOW);
    expect(r1.posted).toBeGreaterThanOrEqual(1);

    const conv = await prisma.aiConversation.findFirstOrThrow({ where: { ownerId: adminId, kind: "sage_direction", archivedAt: null } });
    expect(conv.title).toBe("SAGE — Suivi éditorial");
    const msgs = await prisma.aiConversationMessage.findMany({ where: { conversationId: conv.id, role: "assistant", deletedAt: null, createdAt: { gte: startToday } } });
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toContain("Point de situation éditorial");
    expect(msgs[0].content).toContain("tâche(s) en retard");
    // Le DG a reçu une notification pointant vers la conversation.
    const afterNotif = await prisma.notification.count({ where: { userId: adminId, entityType: "ai_conversation" } });
    expect(afterNotif).toBe(beforeNotif + 1);

    // 2e passage le même jour : SAGE n'écrit pas deux fois (anti-spam).
    const r2 = await runDirectionBrief(NOW);
    expect(r2.posted).toBe(0);
    const msgs2 = await prisma.aiConversationMessage.findMany({ where: { conversationId: conv.id, role: "assistant", deletedAt: null, createdAt: { gte: startToday } } });
    expect(msgs2.length).toBe(1);
  });

  it("la capacité générique écrit un message assistant et réutilise le même fil", async () => {
    const conv = await prisma.aiConversation.findFirstOrThrow({ where: { ownerId: adminId, kind: "sage_direction", archivedAt: null } });
    const before = await prisma.aiConversationMessage.count({ where: { conversationId: conv.id } });
    const r = await sageMessageToDirection({ content: "Note de SAGE : pensez à valider la couverture de l'ouvrage X.", notifyTitle: "SAGE — note", notifyBody: "Une note de SAGE", priority: "low" });
    expect(r.posted).toBeGreaterThanOrEqual(1);
    const after = await prisma.aiConversationMessage.count({ where: { conversationId: conv.id } });
    expect(after).toBe(before + 1); // même fil réutilisé, pas de nouvelle conversation
    // Le fil apparaît dans la liste des conversations du DG.
    const convs = await prisma.aiConversation.findMany({ where: { ownerId: adminId, kind: "sage_direction", archivedAt: null } });
    expect(convs.length).toBe(1);
  });
});
