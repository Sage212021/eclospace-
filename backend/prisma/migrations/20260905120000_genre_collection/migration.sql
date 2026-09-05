-- Rattachement du domaine (genre) à sa collection (D-025, tableau officiel des
-- collections Éclosion). NULL = domaine sans collection dédiée. Sert à l'analyse
-- IA « adéquation avec la ligne éditoriale ».
ALTER TABLE "genres" ADD COLUMN "collection_id" TEXT;
ALTER TABLE "genres" ADD CONSTRAINT "genres_collection_id_fkey"
  FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "genres_collection_id_idx" ON "genres"("collection_id");
