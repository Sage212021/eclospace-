-- Passe de correction de couverture (BAT1/BAT2) sur le job de relecture IA.
ALTER TABLE "ai_reading_jobs" ADD COLUMN "cover_pass" TEXT;
