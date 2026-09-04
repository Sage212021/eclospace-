-- Grille d'évaluation par TYPE de manuscrit : un critère peut être rattaché à un
-- domaine (genre_id). NULL = grille par défaut (tous types).
ALTER TABLE "evaluation_criteria" ADD COLUMN "genre_id" TEXT;
ALTER TABLE "evaluation_criteria" ADD CONSTRAINT "evaluation_criteria_genre_id_fkey"
  FOREIGN KEY ("genre_id") REFERENCES "genres"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "evaluation_criteria_genre_id_idx" ON "evaluation_criteria"("genre_id");
