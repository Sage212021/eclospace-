-- Légende bilingue du catalogue (fiche partageable) — demande opérateur 19/11/2026.
-- Synopsis anglais + libellés d'affichage exacts de la fiche (collection, genre,
-- pages) en FR et EN. Tous facultatifs : à défaut on retombe sur le référentiel.
ALTER TABLE "manuscripts" ADD COLUMN "summary_en" TEXT;
ALTER TABLE "manuscripts" ADD COLUMN "legend_pages" INTEGER;
ALTER TABLE "manuscripts" ADD COLUMN "legend_collection_fr" TEXT;
ALTER TABLE "manuscripts" ADD COLUMN "legend_collection_en" TEXT;
ALTER TABLE "manuscripts" ADD COLUMN "legend_genre_fr" TEXT;
ALTER TABLE "manuscripts" ADD COLUMN "legend_genre_en" TEXT;

ALTER TABLE "manuscripts" ADD COLUMN "legend_isbn" TEXT;
