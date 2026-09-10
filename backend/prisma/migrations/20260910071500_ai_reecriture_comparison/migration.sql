-- Comparaison avant/après de la réécriture IA : on conserve, sur le job de
-- réécriture, le TEXTE SOURCE analysé et le TEXTE RÉÉCRIT proposé, afin d'offrir
-- une vue « version originale / version proposée » sans réextraire les fichiers.
-- Additif, nullable : uniquement renseigné pour les réécritures.
ALTER TABLE "ai_reading_jobs" ADD COLUMN "source_text" TEXT;
ALTER TABLE "ai_reading_jobs" ADD COLUMN "rewrite_text" TEXT;
