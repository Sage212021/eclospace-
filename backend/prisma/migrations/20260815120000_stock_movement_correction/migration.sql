-- Correction des mouvements de stock (magasinier) : le stock touché (condition)
-- est mémorisé pour contre-passer le bon compartiment ; ajout d'un statut
-- « annulé » et des champs d'annulation. Additif uniquement.
ALTER TYPE "StockMovementStatus" ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE "stock_movements" ADD COLUMN "condition" "StockItemCondition" NOT NULL DEFAULT 'vendable';
ALTER TABLE "stock_movements" ADD COLUMN "cancelled_at" TIMESTAMP(3);
ALTER TABLE "stock_movements" ADD COLUMN "cancelled_by" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN "cancel_reason" TEXT;
