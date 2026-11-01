import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { syncServiceUsage, syncAutoUsage, UsageSyncError } from "../src/lib/digitalServicesUsageSync.js";

// Synchronisation de la consommation AUTOMATIQUE (fetch moqué). Met à jour la
// conso et la date de synchro ; enregistre l'erreur sans planter ; ne touche pas
// un service en saisie manuelle.

const rnd = () => Math.random().toString(36).slice(2, 7);
const okResponse = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response);
const errResponse = (status: number): Response => ({ ok: false, status, json: async () => ({}), text: async () => "boom" } as unknown as Response);
const costBody = (cents: string) => ({ data: [{ results: [{ amount: cents, currency: "USD" }] }], has_more: false, next_page: null });

describe("synchro consommation auto", () => {
  let adminId: string;
  const OLD = process.env.ANTHROPIC_ADMIN_KEY;

  beforeAll(async () => {
    await buildApp();
    adminId = (await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).id;
  });
  beforeEach(() => { process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test"; });
  afterEach(() => { process.env.ANTHROPIC_ADMIN_KEY = OLD; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  afterAll(async () => { await prisma.$disconnect(); });

  const mkService = (auto: string | null) =>
    prisma.digitalService.create({
      data: { key: `sync_${rnd()}${rnd()}`, name: "Service sync", kind: "usage_based", active: true, usageAutoSource: auto, createdBy: adminId, updatedBy: adminId },
    });

  it("met à jour la conso (USD), la période et la date de synchro", async () => {
    const svc = await mkService("anthropic_cost");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(costBody("4200")))); // 42,00 USD
    const updated = await syncServiceUsage(svc.id, new Date("2026-11-10T00:00:00Z"));
    expect(Number(updated.currentUsage)).toBe(42);
    expect(updated.usagePeriod).toBe("2026-11");
    expect(updated.usageSyncedAt).not.toBeNull();
    expect(updated.usageSyncError).toBeNull();
  });

  it("enregistre l'erreur (sans planter) quand l'API échoue", async () => {
    const svc = await mkService("anthropic_cost");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errResponse(500)));
    await expect(syncServiceUsage(svc.id)).rejects.toBeTruthy();
    const after = await prisma.digitalService.findUniqueOrThrow({ where: { id: svc.id } });
    expect(after.usageSyncError).toBeTruthy();
  });

  it("refuse un service sans lecture auto (saisie manuelle intouchée)", async () => {
    const svc = await mkService(null);
    await expect(syncServiceUsage(svc.id)).rejects.toBeInstanceOf(UsageSyncError);
  });

  it("syncAutoUsage est best-effort : compte réussites et échecs", async () => {
    await mkService("anthropic_cost");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(costBody("100"))));
    const r = await syncAutoUsage(new Date("2026-11-10T00:00:00Z"));
    expect(r.updated).toBeGreaterThanOrEqual(1);
    expect(r.failed).toBe(0);
  });
});
