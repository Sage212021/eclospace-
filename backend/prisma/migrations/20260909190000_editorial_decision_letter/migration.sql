-- Décision éditoriale : nouveau type « refus avec possibilité de nouvelle
-- soumission » + éléments communicables à l'auteur (message complémentaire de la
-- Direction et points essentiels retenus). La lettre à l'auteur n'extrait que ces
-- éléments, jamais le rapport interne du comité.
ALTER TYPE "EditorialDecisionType" ADD VALUE IF NOT EXISTS 'refus_resoumission';

ALTER TABLE "editorial_decisions" ADD COLUMN "author_message" TEXT;
ALTER TABLE "editorial_decisions" ADD COLUMN "author_points" JSONB;
