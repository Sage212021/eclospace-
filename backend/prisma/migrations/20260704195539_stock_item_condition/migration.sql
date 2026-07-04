-- CreateEnum
CREATE TYPE "StockItemCondition" AS ENUM ('vendable', 'declasse');

-- DropIndex
DROP INDEX "stock_items_isbn_id_location_id_print_run_key";

-- AlterTable
ALTER TABLE "stock_items" ADD COLUMN     "condition" "StockItemCondition" NOT NULL DEFAULT 'vendable';

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_isbn_id_location_id_print_run_condition_key" ON "stock_items"("isbn_id", "location_id", "print_run", "condition");

