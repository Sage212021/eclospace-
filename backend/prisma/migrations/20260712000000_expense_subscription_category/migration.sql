-- Option A : catégorie dédiée aux abonnements et services en ligne
-- (hébergement, outils IA, pages sponsorisées…) dans le module Dépenses.
-- Ajout d'une valeur d'enum uniquement ; aucune donnée existante impactée.
ALTER TYPE "ExpenseCategory" ADD VALUE 'abonnement';
