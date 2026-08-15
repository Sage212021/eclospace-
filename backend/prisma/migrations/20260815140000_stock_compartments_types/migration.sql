-- Lot 1 magasin : compartiments de stock enrichis (perdu / détruit) et nouveaux
-- types de mouvements (§5, §7). Additif uniquement — aucun impact sur l'existant.

-- Compartiments physiques additionnels.
ALTER TYPE "StockItemCondition" ADD VALUE IF NOT EXISTS 'perdu';
ALTER TYPE "StockItemCondition" ADD VALUE IF NOT EXISTS 'detruit';

-- Nouveaux types de mouvements.
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'supplier_in';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'commercial_return';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'promotional_out';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'institutional_out';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'event_out';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'free_out';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'loss';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'damage';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'destruction';
