-- Retrait d'un visuel (infographie) déposé par erreur : suppression logique.
ALTER TABLE "image_assets" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "image_assets" ADD COLUMN "deleted_by" TEXT;
