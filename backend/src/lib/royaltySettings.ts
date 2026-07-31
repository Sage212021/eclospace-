import { prisma } from "./prisma.js";
import { writeAuditLog } from "./audit.js";

// Retenue à la source sur les droits d'auteur : réglage activable/désactivable
// (demande opérateur). La réglementation camerounaise peut évoluer — ou ne pas
// exiger de retenue selon le cas ; la DAF (finance:administration) coche ou
// décoche l'option. Décochée, aucune retenue n'est appliquée par défaut aux
// paiements de droits, et elle n'apparaît pas sur les documents générés.

const WITHHOLDING_KEY = "royalty_withholding_enabled";
const DEFAULT_ENABLED = true; // par défaut, la retenue à la source s'applique

// Taux de droits d'auteur du LIVRE SCOLAIRE : 12 % par défaut, quel que soit
// l'ouvrage — mais modulable si la réglementation ou la politique maison venait
// à changer (réglage DAF, finance:administration). Une ligne de commande peut
// aussi porter un taux spécifique qui prime sur ce taux maison.
const SCHOOL_RATE_KEY = "royalty.scolaire_default_rate";
export const DEFAULT_SCHOOL_ROYALTY_RATE = 0.12;

export async function getSchoolRoyaltyRate(): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: SCHOOL_RATE_KEY } });
  const v = typeof s?.value === "number" ? s.value : Number(s?.value);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_SCHOOL_ROYALTY_RATE;
}

export async function setSchoolRoyaltyRate(rate: number, actor: { id: string; ip?: string | null }): Promise<number> {
  await prisma.setting.upsert({
    where: { key: SCHOOL_RATE_KEY },
    update: { value: rate, updatedBy: actor.id },
    create: { key: SCHOOL_RATE_KEY, value: rate, updatedBy: actor.id },
  });
  await writeAuditLog({
    userId: actor.id,
    action: "update",
    entityType: "royalty_scolaire_default_rate",
    entityId: SCHOOL_RATE_KEY,
    newValues: { rate },
    ipAddress: actor.ip ?? null,
  });
  return rate;
}

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
