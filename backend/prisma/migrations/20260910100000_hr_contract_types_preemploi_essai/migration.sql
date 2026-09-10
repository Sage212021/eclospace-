-- Deux nouveaux types de contrat de travail RH demandés par l'opérateur :
-- « Pré-emploi » (contrat/stage de pré-emploi, ex. jeune diplômé) et « Essai »
-- (contrat d'essai court). Additif : les types existants restent inchangés.
ALTER TYPE "HrContractType" ADD VALUE IF NOT EXISTS 'pre_emploi';
ALTER TYPE "HrContractType" ADD VALUE IF NOT EXISTS 'essai';
