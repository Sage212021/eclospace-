-- Lot 3 stock commercial (§10) : un lieu de stock individuel par commercial,
-- rattaché à son compte. Additif uniquement.
ALTER TYPE "StockLocationType" ADD VALUE IF NOT EXISTS 'stock_commercial';

ALTER TABLE "stock_locations" ADD COLUMN "commercial_user_id" TEXT;
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_commercial_user_id_fkey"
  FOREIGN KEY ("commercial_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
