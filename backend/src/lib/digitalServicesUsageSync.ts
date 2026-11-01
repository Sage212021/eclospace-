import { prisma } from "./prisma.js";
import { AnthropicUsageError, fetchAnthropicMonthCostUsd } from "./anthropicUsage.js";

// Synchronisation de la consommation AUTOMATIQUE des services numériques dont la
// source est renseignée (aujourd'hui : "anthropic_cost" → API Anthropic). Met à
// jour `currentUsage` (coût du mois), `usagePeriod` et `usageSyncedAt`. En cas
// d'échec, enregistre `usageSyncError` (affiché à l'admin) sans jamais planter.
//
// La saisie MANUELLE reste possible : un service sans source auto n'est pas touché.

export const AUTO_SOURCE_ANTHROPIC = "anthropic_cost";

export class UsageSyncError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "UsageSyncError";
  }
}

// Synchronise UN service. Lève UsageSyncError (not_found / not_auto) ou
// AnthropicUsageError (not_configured / http_* / network). En cas d'erreur API,
// l'erreur est AUSSI persistée dans usageSyncError avant d'être relancée.
export async function syncServiceUsage(serviceId: string, now: Date = new Date()) {
  const service = await prisma.digitalService.findFirst({ where: { id: serviceId, deletedAt: null } });
  if (!service) throw new UsageSyncError("not_found", "Service introuvable.");
  if (service.usageAutoSource !== AUTO_SOURCE_ANTHROPIC) {
    throw new UsageSyncError("not_auto", "Ce service n'a pas de lecture automatique de la consommation.");
  }

  try {
    const cost = await fetchAnthropicMonthCostUsd(now);
    return await prisma.digitalService.update({
      where: { id: serviceId },
      data: {
        currentUsage: cost.amountUsd,
        usagePeriod: cost.periodKey,
        usageSyncedAt: new Date(),
        usageSyncError: null,
      },
    });
  } catch (e) {
    const message = e instanceof AnthropicUsageError ? e.message : (e instanceof Error ? e.message : "Erreur de synchronisation.");
    // On enregistre l'erreur pour l'affichage, sans écraser la dernière conso connue.
    await prisma.digitalService.update({ where: { id: serviceId }, data: { usageSyncError: message } }).catch(() => {});
    throw e;
  }
}

// Synchronise TOUS les services actifs à lecture automatique. Best-effort : une
// panne sur un service n'interrompt pas les autres ni le planificateur.
export async function syncAutoUsage(now: Date = new Date()): Promise<{ updated: number; failed: number }> {
  const services = await prisma.digitalService.findMany({
    where: { deletedAt: null, active: true, usageAutoSource: AUTO_SOURCE_ANTHROPIC },
    select: { id: true },
  });
  let updated = 0;
  let failed = 0;
  for (const s of services) {
    try {
      await syncServiceUsage(s.id, now);
      updated++;
    } catch {
      failed++;
    }
  }
  return { updated, failed };
}
