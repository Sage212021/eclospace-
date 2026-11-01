// Lecture AUTOMATIQUE de la consommation de l'API Anthropic (coût du mois en
// cours), via l'« Usage and Cost API » d'Anthropic (endpoint cost_report).
//
// SÉCURITÉ : la clé d'ADMINISTRATION (sk-ant-admin…) n'est JAMAIS stockée en
// base ni dans le code ni affichée. Elle est lue au moment de l'appel dans le
// coffre à secrets de l'hébergeur (variable d'environnement ANTHROPIC_ADMIN_KEY).
// Cette clé sert UNIQUEMENT à LIRE la consommation ; aucun paiement n'est jamais
// déclenché depuis Éclospace.
//
// Doc : https://platform.claude.com/docs/en/manage-claude/usage-cost-api
//   GET https://api.anthropic.com/v1/organizations/cost_report?starting_at=…&ending_at=…
//   En-têtes : anthropic-version: 2023-06-01 · x-api-key: <clé admin>
//   Montants en USD, exprimés en CENTS (chaînes décimales). Granularité : 1 jour.
//   Pagination : has_more / next_page.

const BASE_URL = process.env.ANTHROPIC_BASE_URL?.replace(/\/+$/, "") || "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

export function isAnthropicUsageConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_ADMIN_KEY && process.env.ANTHROPIC_ADMIN_KEY.trim());
}

export class AnthropicUsageError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "AnthropicUsageError";
  }
}

// Début du mois courant (UTC) → maintenant. L'API borne au jour ; on demande du
// 1er du mois (00:00 UTC) jusqu'à maintenant.
function monthRange(now: Date): { since: string; until: string; periodKey: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return { since: start.toISOString(), until: now.toISOString(), periodKey };
}

// Additionne tous les montants (en cents) d'une réponse cost_report, quelle que
// soit la forme exacte (buckets `data[].results[].amount` — parseur tolérant).
function sumCents(payload: unknown): number {
  let cents = 0;
  const buckets = (payload as { data?: unknown[] })?.data;
  if (!Array.isArray(buckets)) return 0;
  for (const bucket of buckets) {
    const results = (bucket as { results?: unknown[] })?.results;
    if (!Array.isArray(results)) continue;
    for (const r of results) {
      const amount = (r as { amount?: unknown })?.amount;
      const n = typeof amount === "number" ? amount : Number(amount);
      if (Number.isFinite(n)) cents += n;
    }
  }
  return cents;
}

export interface AnthropicCost {
  amountUsd: number;   // coût du mois en dollars
  periodKey: string;   // "2026-11"
  since: string;
  until: string;
}

// Coût TOTAL de l'organisation pour le mois en cours, en USD. Lève
// AnthropicUsageError si la clé est absente ou si l'API répond en erreur.
export async function fetchAnthropicMonthCostUsd(now: Date = new Date()): Promise<AnthropicCost> {
  const key = process.env.ANTHROPIC_ADMIN_KEY?.trim();
  if (!key) {
    throw new AnthropicUsageError(
      "not_configured",
      "Clé d'administration Anthropic absente (variable ANTHROPIC_ADMIN_KEY côté hébergeur).",
    );
  }
  const { since, until, periodKey } = monthRange(now);

  let totalCents = 0;
  let page: string | undefined;
  // Pagination défensive (max 40 pages → ~ largement suffisant pour un mois).
  for (let i = 0; i < 40; i++) {
    const url = new URL(`${BASE_URL}/v1/organizations/cost_report`);
    url.searchParams.set("starting_at", since);
    url.searchParams.set("ending_at", until);
    if (page) url.searchParams.set("page", page);

    let resp: Response;
    try {
      resp = await fetch(url.toString(), {
        method: "GET",
        headers: { "anthropic-version": ANTHROPIC_VERSION, "x-api-key": key },
      });
    } catch (e) {
      throw new AnthropicUsageError("network", `Appel à l'API Anthropic impossible : ${e instanceof Error ? e.message : "réseau"}.`);
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      const hint = resp.status === 401 || resp.status === 403
        ? " (clé invalide ou sans droit d'administration)"
        : "";
      throw new AnthropicUsageError("http_" + resp.status, `L'API Anthropic a répondu ${resp.status}${hint}. ${body.slice(0, 200)}`.trim());
    }
    const payload = (await resp.json().catch(() => ({}))) as { has_more?: boolean; next_page?: string };
    totalCents += sumCents(payload);
    if (payload.has_more && payload.next_page) page = payload.next_page;
    else break;
  }

  return { amountUsd: Math.round(totalCents) / 100, periodKey, since, until };
}
