import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { runSubscriptionWatch } from "../src/lib/digitalServicesWatch.js";

// Veille automatique des abonnements (Phase B) : alertes d'échéance et de
// consommation, émises une seule fois (anti-doublon), ré-ouvertes à chaque cycle.

const rnd = () => Math.random().toString(36).slice(2, 7);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

describe("Veille automatique des abonnements", () => {
  let adminId: string;

  beforeAll(async () => {
    // buildApp pour initialiser le contexte (prisma, etc.) comme les autres tests.
    await buildApp();
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const mkService = (data: Partial<{ nextDueDate: Date; kind: "subscription_monthly" | "usage_based"; monthlyBudget: number; currentUsage: number; usagePeriod: string }>) =>
    prisma.digitalService.create({
      data: {
        key: `watch_${rnd()}${rnd()}`, name: "Service veille", active: true,
        kind: data.kind ?? "subscription_monthly",
        nextDueDate: data.nextDueDate ?? null,
        monthlyBudget: data.monthlyBudget ?? null, currentUsage: data.currentUsage ?? null, usagePeriod: data.usagePeriod ?? null,
        createdBy: adminId, updatedBy: adminId,
      },
    });

  it("émet une alerte d'échéance (J-3), une seule fois, et notifie l'administrateur", async () => {
    const svc = await mkService({ nextDueDate: inDays(2) }); // dans la bande J-3
    const before = await prisma.notification.count({ where: { userId: adminId, entityType: "digital_service", entityId: svc.id } });

    const r1 = await runSubscriptionWatch();
    expect(r1.sent).toBeGreaterThanOrEqual(1);
    const alerts = await prisma.digitalServiceAlert.findMany({ where: { serviceId: svc.id } });
    expect(alerts.map((a) => a.threshold)).toContain("J-3");
    const after = await prisma.notification.count({ where: { userId: adminId, entityType: "digital_service", entityId: svc.id } });
    expect(after).toBe(before + 1); // l'admin a reçu la notification

    // 2e passage : aucune nouvelle alerte pour ce service (anti-doublon).
    await runSubscriptionWatch();
    const alerts2 = await prisma.digitalServiceAlert.findMany({ where: { serviceId: svc.id } });
    expect(alerts2.length).toBe(alerts.length);
  });

  it("émet une alerte « dépassé » pour une échéance passée", async () => {
    const svc = await mkService({ nextDueDate: inDays(-2) });
    await runSubscriptionWatch();
    const alerts = await prisma.digitalServiceAlert.findMany({ where: { serviceId: svc.id } });
    expect(alerts.map((a) => a.threshold)).toContain("overdue");
  });

  it("émet une alerte de consommation (85 %) pour un forfait à l'usage", async () => {
    const svc = await mkService({ kind: "usage_based", monthlyBudget: 100, currentUsage: 88, usagePeriod: "2026-10" });
    await runSubscriptionWatch();
    const alerts = await prisma.digitalServiceAlert.findMany({ where: { serviceId: svc.id, kind: "usage" } });
    expect(alerts.map((a) => a.threshold)).toContain("85");
  });

  it("un nouveau cycle d'échéance ré-ouvre les alertes", async () => {
    const svc = await mkService({ nextDueDate: inDays(2) });
    await runSubscriptionWatch();
    const n1 = (await prisma.digitalServiceAlert.findMany({ where: { serviceId: svc.id } })).length;
    // L'échéance avance (comme après un paiement confirmé) → nouveau cycle (date différente).
    await prisma.digitalService.update({ where: { id: svc.id }, data: { nextDueDate: inDays(3 + 2) } }); // ~J-3 d'une AUTRE date
    await runSubscriptionWatch();
    const n2 = (await prisma.digitalServiceAlert.findMany({ where: { serviceId: svc.id } })).length;
    expect(n2).toBeGreaterThan(n1); // une nouvelle alerte pour le nouveau cycle
  });

  it("n'alerte pas un service inactif", async () => {
    const svc = await mkService({ nextDueDate: inDays(-1) });
    await prisma.digitalService.update({ where: { id: svc.id }, data: { active: false } });
    await runSubscriptionWatch();
    const alerts = await prisma.digitalServiceAlert.findMany({ where: { serviceId: svc.id } });
    expect(alerts.length).toBe(0);
  });
});
