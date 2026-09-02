import { prisma } from "./prisma.js";

// Configuration (paramétrable par l'administration) du bandeau « Programme à
// venir » du Hall. Valeurs par défaut retenues avec l'opérateur (01/09/2026),
// modifiables ensuite sans redéploiement. Stockée dans la table `Setting`
// (clé/valeur JSON), lue en fusion avec les défauts pour rester robuste si un
// champ manque.

export interface HallAgendaConfig {
  // Bandeau actif ? (permet de le couper entièrement sans toucher au code)
  enabled: boolean;
  // Cadence de réapparition du bandeau, en minutes (« rappel discret »).
  reappearMinutes: number;
  // Durée d'affichage d'une capsule, en secondes.
  capsuleSeconds: number;
  // Fenêtre « à venir » prise en compte, en jours.
  horizonDays: number;
  // Seuil d'« imminence » (événement mis en tête, en rouge), en minutes.
  urgentMinutes: number;
}

export const DEFAULT_HALL_AGENDA: HallAgendaConfig = {
  enabled: true,
  reappearMinutes: 20,
  capsuleSeconds: 6,
  horizonDays: 60,
  urgentMinutes: 15,
};

const KEY = "hall_agenda_config";

export async function getHallAgendaConfig(): Promise<HallAgendaConfig> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  if (!row) return DEFAULT_HALL_AGENDA;
  const v = (row.value ?? {}) as Partial<HallAgendaConfig>;
  return { ...DEFAULT_HALL_AGENDA, ...v };
}

export async function setHallAgendaConfig(next: HallAgendaConfig): Promise<HallAgendaConfig> {
  // Objet « à plat » (valeurs JSON simples) pour la colonne Json de Prisma.
  const value = {
    enabled: next.enabled,
    reappearMinutes: next.reappearMinutes,
    capsuleSeconds: next.capsuleSeconds,
    horizonDays: next.horizonDays,
    urgentMinutes: next.urgentMinutes,
  };
  await prisma.setting.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
  return next;
}
