-- Bon de commande : qui l'a établi (nom instantané + fonction choisie :
-- impression / stock / daf).
ALTER TABLE "purchase_orders" ADD COLUMN "established_by_name" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "established_by_function" TEXT;
