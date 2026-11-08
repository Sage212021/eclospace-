import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { runEditorialDeadlineWatch } from "../src/lib/editorialDeadlineWatch.js";
import { createUserWithRole } from "./helpers.js";

// Veille automatique des ÉCHÉANCES ÉDITORIALES : alertes d'échéance proche /
// dépassée sur les tâches non terminées, émises une seule fois (anti-doublon),
// ré-ouvertes quand la tâche est replanifiée. Destinataires : le DG
// (ADMIN_GENERAL) et le responsable de la tâche.

const rnd = () => Math.random().toString(36).slice(2, 7);
const NOW = new Date("2026-06-15T10:00:00Z");
const atDay = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000);

describe("Veille automatique des échéances éditoriales", () => {
  let adminId: string;
  let statusId: string;
  let assigneeId: string;

  beforeAll(async () => {
    await buildApp();
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
    statusId = (await prisma.workflowStatus.findFirstOrThrow({ where: { code: "CORRECTION" } })).id;
    const u = await createUserWithRole(`resp_${rnd()}`, "CORRECTEUR", "TestPwd123!");
    assigneeId = u.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const mkTask = async (plannedEnd: Date, status: "non_commencee" | "en_cours" | "terminee" = "en_cours") => {
    const m = await prisma.manuscript.create({
      data: { manuscriptNumber: `MS-ECH-${rnd()}`, title: `Échéance ${rnd()}`, statusId, ownerId: adminId, origin: "soumission", language: "fr", receivedAt: new Date() },
    });
    const t = await prisma.task.create({
      data: { manuscriptId: m.id, title: "Correction éditoriale", type: "correction", assigneeId, plannedEnd, status, createdBy: adminId, updatedBy: adminId },
    });
    return { manuscriptId: m.id, taskId: t.id };
  };

  it("émet une alerte « échéance proche » (J-3) une seule fois et notifie le DG et le responsable", async () => {
    const { manuscriptId, taskId } = await mkTask(atDay(2)); // dans 2 jours → bande J-3
    const beforeAdmin = await prisma.notification.count({ where: { userId: adminId, entityType: "manuscript", entityId: manuscriptId } });
    const beforeResp = await prisma.notification.count({ where: { userId: assigneeId, entityType: "manuscript", entityId: manuscriptId } });

    const r1 = await runEditorialDeadlineWatch(NOW);
    expect(r1.sent).toBeGreaterThanOrEqual(1);
    const alerts = await prisma.editorialDeadlineAlert.findMany({ where: { taskId } });
    expect(alerts.map((a) => a.threshold)).toContain("J-3");
    expect(await prisma.notification.count({ where: { userId: adminId, entityType: "manuscript", entityId: manuscriptId } })).toBe(beforeAdmin + 1);
    expect(await prisma.notification.count({ where: { userId: assigneeId, entityType: "manuscript", entityId: manuscriptId } })).toBe(beforeResp + 1);

    // 2e passage : anti-doublon, aucune nouvelle alerte pour cette tâche.
    await runEditorialDeadlineWatch(NOW);
    expect((await prisma.editorialDeadlineAlert.findMany({ where: { taskId } })).length).toBe(alerts.length);
  });

  it("émet une alerte « en retard » pour une échéance dépassée", async () => {
    const { taskId } = await mkTask(atDay(-2)); // échéance passée de 2 jours
    await runEditorialDeadlineWatch(NOW);
    const alerts = await prisma.editorialDeadlineAlert.findMany({ where: { taskId } });
    expect(alerts.map((a) => a.threshold)).toContain("overdue");
  });

  it("replanifier la tâche (nouvelle échéance) ré-ouvre les alertes", async () => {
    const { taskId } = await mkTask(atDay(2));
    await runEditorialDeadlineWatch(NOW);
    const n1 = (await prisma.editorialDeadlineAlert.findMany({ where: { taskId } })).length;
    await prisma.task.update({ where: { id: taskId }, data: { plannedEnd: atDay(5) } }); // autre date, bande J-7
    await runEditorialDeadlineWatch(NOW);
    const n2 = (await prisma.editorialDeadlineAlert.findMany({ where: { taskId } })).length;
    expect(n2).toBeGreaterThan(n1);
  });

  it("n'alerte pas une tâche déjà terminée", async () => {
    const { taskId } = await mkTask(atDay(-3), "terminee");
    await runEditorialDeadlineWatch(NOW);
    expect((await prisma.editorialDeadlineAlert.findMany({ where: { taskId } })).length).toBe(0);
  });
});
