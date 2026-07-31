-- Segment éditorial d'un ouvrage : base de la ventilation du chiffre d'affaires
-- livre (scolaire & parascolaire vs général & littérature). Décision opérateur
-- du 31/07/2026 : l'éditorial classe chaque ouvrage.
DO $$ BEGIN
  CREATE TYPE "EditorialSegment" AS ENUM ('scolaire', 'general');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "manuscripts" ADD COLUMN IF NOT EXISTS "editorial_segment" "EditorialSegment";
