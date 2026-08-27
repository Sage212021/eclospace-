-- Scellé d'archivage définitif (26/08/2026) : un dossier archivé peut être scellé
-- → lecture seule totale. Migration additive.
ALTER TABLE "manuscripts" ADD COLUMN "sealed_at" TIMESTAMP(3);
ALTER TABLE "manuscripts" ADD COLUMN "sealed_by" TEXT;
