-- Modèle économique du contrat (D-054, demande opérateur du 25/10/2026).
-- Axe distinct du type juridique. Nullable : les contrats antérieurs n'en
-- portent pas (comportement hérité conservé, aucune donnée réécrite).

-- CreateEnum
CREATE TYPE "EconomicModel" AS ENUM ('compte_editeur', 'compte_auteur', 'compte_demi', 'autre');

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN "economic_model" "EconomicModel";
