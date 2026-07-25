import { prisma } from "./prisma.js";
import { writeAuditLog } from "./audit.js";

// Retenue à la source sur les droits d'auteur : réglage activable/désactivable
// (demande opérateur). La réglementation camerounaise peut évoluer — ou ne pas
// exiger de retenue selon le cas ; la DAF (finance:administration) coche ou
// décoche l'option. Décochée, aucune retenue n'est appliquée par défaut aux
// paiements de droits, et elle n'apparaît pas sur les documents générés.

const WITHHOLDING_KEY = "royalty_withholding_enabled";
const DEFAULT_ENABLED = true; // par défaut, la retenue à la source s'applique

export async function getRoyaltyWithholdingEnabled(): Promise<boolean> {
  const s = await prisma.setting.findUnique({ where: { key: WITHHOLDING_KEY } });
  if (s == null) return DEFAULT_ENABLED;
  return s.value === true || s.value === "true";
}

export async function setRoyaltyWithholdingEnabled(enabled: boolean, actor: { id: string; ip?: string | null }): Promise<boolean> {
  await prisma.setting.upsert({
    where: { key: WITHHOLDING_KEY },
    update: { value: enabled, updatedBy: actor.id },
    create: { key: WITHHOLDING_KEY, value: enabled, updatedBy: actor.id },
  });
  await writeAuditLog({
    userId: actor.id,
    action: "update",
    entityType: "royalty_withholding_enabled",
    entityId: WITHHOLDING_KEY,
    newValues: { enabled },
    ipAddress: actor.ip ?? null,
  });
  return enabled;
}
