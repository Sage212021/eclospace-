-- Étapes « à option » (Expertise, Réécriture, Projet/Planification) : décision
-- opérateur (réalisée avec ses éléments, ou passée avec motif).
ALTER TABLE "manuscript_steps" ADD COLUMN "realization_mode" TEXT;
ALTER TABLE "manuscript_steps" ADD COLUMN "skip_reason" TEXT;
ALTER TABLE "manuscript_steps" ADD COLUMN "realization_data" JSONB;
