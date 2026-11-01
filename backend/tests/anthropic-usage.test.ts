import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicUsageError, fetchAnthropicMonthCostUsd, isAnthropicUsageConfigured } from "../src/lib/anthropicUsage.js";

// Lecture du coût du mois via l'« Usage and Cost API » d'Anthropic. On MOQUE
// `fetch` : aucun appel réseau réel, aucune vraie clé. Les montants sont en CENTS
// (chaînes décimales) → convertis en dollars.

const okResponse = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response);
const errResponse = (status: number): Response => ({ ok: false, status, json: async () => ({}), text: async () => "boom" } as unknown as Response);

describe("anthropicUsage — coût du mois (fetch moqué)", () => {
  const OLD = process.env.ANTHROPIC_ADMIN_KEY;
  beforeEach(() => { process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin-test"; });
  afterEach(() => { process.env.ANTHROPIC_ADMIN_KEY = OLD; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("additionne les montants (cents) de toutes les pages → dollars", async () => {
    const page1 = { data: [{ results: [{ amount: "1234", currency: "USD" }, { amount: "766", currency: "USD" }] }], has_more: true, next_page: "p2" };
    const page2 = { data: [{ results: [{ amount: "5000", currency: "USD" }] }], has_more: false, next_page: null };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse(page1))
      .mockResolvedValueOnce(okResponse(page2));
    vi.stubGlobal("fetch", fetchMock);

    const r = await fetchAnthropicMonthCostUsd(new Date("2026-11-15T10:00:00Z"));
    // 1234 + 766 + 5000 = 7000 cents = 70.00 USD
    expect(r.amountUsd).toBe(70);
    expect(r.periodKey).toBe("2026-11");
    expect(fetchMock).toHaveBeenCalledTimes(2); // pagination suivie
    // La clé part bien dans l'en-tête x-api-key (jamais dans l'URL).
    const [, opts] = fetchMock.mock.calls[0];
    expect((opts.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-admin-test");
  });

  it("lève une erreur « non configuré » sans clé", async () => {
    delete process.env.ANTHROPIC_ADMIN_KEY;
    await expect(fetchAnthropicMonthCostUsd()).rejects.toBeInstanceOf(AnthropicUsageError);
    expect(isAnthropicUsageConfigured()).toBe(false);
  });

  it("remonte une erreur HTTP (ex. 401 clé invalide)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errResponse(401)));
    await expect(fetchAnthropicMonthCostUsd()).rejects.toMatchObject({ code: "http_401" });
  });
});
