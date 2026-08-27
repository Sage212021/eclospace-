import { prisma } from "./prisma.js";

// Règles « comité professionnel » (audit éditorial, point n°3), activables au
// choix de la maison. Désactivées par défaut : le comité fonctionne comme
// aujourd'hui (un seul rapport suffit, aucune déclaration demandée). Le jour où
// la maison grandit, un administrateur les active dans les Paramètres.
export interface ReadingCommitteeRules {
  quorumEnabled: boolean; // exiger un nombre minimal de lecteurs avant décision
  quorum: number; // nombre de rapports remis exigés (>= 1)
  conflictEnabled: boolean; // exiger une déclaration de conflit d'intérêt à la remise
}

export const DEFAULT_READING_COMMITTEE_RULES: ReadingCommitteeRules = {
  quorumEnabled: false,
  quorum: 2,
  conflictEnabled: false,
};

export const READING_COMMITTEE_RULES_KEY = "reading_committee_rules";

export async function readingCommitteeRules(): Promise<ReadingCommitteeRules> {
  const s = await prisma.setting.findUnique({ where: { key: READING_COMMITTEE_RULES_KEY } });
  const v = (s?.value ?? {}) as Partial<ReadingCommitteeRules>;
  const quorum = Math.max(1, Math.min(10, Math.round(Number(v.quorum ?? DEFAULT_READING_COMMITTEE_RULES.quorum)) || DEFAULT_READING_COMMITTEE_RULES.quorum));
  return {
    quorumEnabled: v.quorumEnabled ?? DEFAULT_READING_COMMITTEE_RULES.quorumEnabled,
    quorum,
    conflictEnabled: v.conflictEnabled ?? DEFAULT_READING_COMMITTEE_RULES.conflictEnabled,
  };
}
