-- Intégrateur des corrections (relais du cycle de correction). Colonne
-- additive nullable + FK vers users ; aucune donnée touchée.
ALTER TABLE "manuscripts" ADD COLUMN "correction_integrator_id" TEXT;
ALTER TABLE "manuscripts" ADD CONSTRAINT "manuscripts_correction_integrator_id_fkey" FOREIGN KEY ("correction_integrator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
