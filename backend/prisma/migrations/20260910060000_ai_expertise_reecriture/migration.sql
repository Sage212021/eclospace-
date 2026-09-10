-- Deux nouveaux types de travail IA, branchés sur des ÉTAPES éditoriales qui
-- existent déjà (EXPERTISE, REECRITURE) : l'assistant IA « expertise
-- scientifique » (rapport + proposition d'avis) et « réécriture » (nouvelle
-- version du manuscrit + rapport de réécriture). Additif : aucune donnée
-- existante n'est touchée, les 4 types actuels restent inchangés.
ALTER TYPE "AiWorkType" ADD VALUE IF NOT EXISTS 'expertise';
ALTER TYPE "AiWorkType" ADD VALUE IF NOT EXISTS 'reecriture';
