-- Infographe désigné pour l'intégration de la correction de couverture.
ALTER TABLE "manuscripts" ADD COLUMN "cover_integrator_id" TEXT;
ALTER TABLE "manuscripts"
  ADD CONSTRAINT "manuscripts_cover_integrator_id_fkey"
  FOREIGN KEY ("cover_integrator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
