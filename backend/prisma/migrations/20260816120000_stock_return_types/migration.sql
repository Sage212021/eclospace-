-- Nouveaux types de mouvement : retours (événement, promotion, autre) — entrées magasin.
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'event_return';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'promotional_return';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'other_return';
