-- CreateEnum
CREATE TYPE "StockLocationType" AS ENUM ('entrepot', 'depot', 'depot_vente', 'emplacement');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('production_in', 'sale_out', 'consignment_out', 'consignment_return', 'customer_return', 'transfer', 'press_copy', 'author_copy', 'pulping', 'inventory_adjustment');

-- CreateEnum
CREATE TYPE "StockMovementStatus" AS ENUM ('pending', 'in_transit', 'completed');

-- CreateEnum
CREATE TYPE "InventoryType" AS ENUM ('full', 'rotating');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "CustomerCategory" AS ENUM ('librairie', 'distributeur', 'institution', 'particulier', 'plateforme');

-- CreateEnum
CREATE TYPE "RelationMode" AS ENUM ('ferme', 'depot_vente');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('representant', 'telephone', 'salon', 'en_ligne', 'comptoir');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('draft', 'blocked_credit', 'confirmed', 'preparing', 'shipped', 'delivered', 'invoiced', 'cancelled');

-- CreateEnum
CREATE TYPE "ConsignmentStatus" AS ENUM ('active', 'closed');

-- CreateEnum
CREATE TYPE "PosPaymentMethod" AS ENUM ('cash', 'card', 'mobile_money');

-- CreateEnum
CREATE TYPE "ReturnLineVerdict" AS ENUM ('resaleable', 'damaged', 'pulp');

-- AlterTable
ALTER TABLE "purchase_orders" DROP COLUMN "delivery_location",
ADD COLUMN     "delivery_location_id" TEXT;

-- CreateTable
CREATE TABLE "stock_locations" (
    "id" TEXT NOT NULL,
    "type" "StockLocationType" NOT NULL,
    "label" TEXT NOT NULL,
    "parent_id" TEXT,
    "customer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_items" (
    "id" TEXT NOT NULL,
    "isbn_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "print_run" INTEGER NOT NULL,
    "quantity_physical" INTEGER NOT NULL DEFAULT 0,
    "quantity_reserved" INTEGER NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(10,2),
    "alert_threshold" INTEGER,
    "out_of_stock_threshold" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "isbn_id" TEXT NOT NULL,
    "print_run" INTEGER NOT NULL,
    "from_location_id" TEXT,
    "to_location_id" TEXT,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "status" "StockMovementStatus" NOT NULL DEFAULT 'completed',
    "moved_by" TEXT,
    "moved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventories" (
    "id" TEXT NOT NULL,
    "type" "InventoryType" NOT NULL,
    "location_id" TEXT,
    "blind" BOOLEAN NOT NULL DEFAULT true,
    "status" "InventoryStatus" NOT NULL DEFAULT 'open',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "opened_by" TEXT,

    CONSTRAINT "inventories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_lines" (
    "id" TEXT NOT NULL,
    "inventory_id" TEXT NOT NULL,
    "isbn_id" TEXT NOT NULL,
    "theoretical_qty" INTEGER NOT NULL,
    "counted_qty" INTEGER,
    "variance" INTEGER,
    "recount_required" BOOLEAN NOT NULL DEFAULT false,
    "adjustment_movement_id" TEXT,

    CONSTRAINT "inventory_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "category" "CustomerCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "relation_mode" "RelationMode" NOT NULL DEFAULT 'ferme',
    "payment_terms" TEXT,
    "credit_limit" DECIMAL(12,2),
    "tax_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_grids" (
    "id" TEXT NOT NULL,
    "category" "CustomerCategory" NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "discount_grids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_discounts" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL,
    "label" TEXT,
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list" (
    "id" TEXT NOT NULL,
    "isbn_id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "price_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "channel" "SalesChannel" NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'draft',
    "block_reason" TEXT,
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "isbn_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "delivery_number" TEXT NOT NULL,
    "carrier" TEXT,
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "tracking_number" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_lines" (
    "id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "isbn_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "delivery_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consignments" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "location_id" TEXT,
    "isbn_id" TEXT NOT NULL,
    "quantity_deposited" INTEGER NOT NULL,
    "status" "ConsignmentStatus" NOT NULL DEFAULT 'active',
    "deposited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consignment_statements" (
    "id" TEXT NOT NULL,
    "consignment_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "quantity_sold" INTEGER NOT NULL,
    "received_at" TIMESTAMP(3),
    "validated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consignment_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_sales" (
    "id" TEXT NOT NULL,
    "isbn_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "payment_method" "PosPaymentMethod" NOT NULL,
    "event_label" TEXT,
    "sold_by" TEXT,
    "sold_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_returns" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "origin_delivery_id" TEXT,
    "authorized_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_lines" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "isbn_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "verdict" "ReturnLineVerdict",

    CONSTRAINT "return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_isbn_id_location_id_print_run_key" ON "stock_items"("isbn_id", "location_id", "print_run");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_lines_adjustment_movement_id_key" ON "inventory_lines"("adjustment_movement_id");

-- CreateIndex
CREATE UNIQUE INDEX "discount_grids_category_key" ON "discount_grids"("category");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_order_number_key" ON "sales_orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_delivery_number_key" ON "deliveries"("delivery_number");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_delivery_location_id_fkey" FOREIGN KEY ("delivery_location_id") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_isbn_id_fkey" FOREIGN KEY ("isbn_id") REFERENCES "isbns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "stock_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_isbn_id_fkey" FOREIGN KEY ("isbn_id") REFERENCES "isbns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lines" ADD CONSTRAINT "inventory_lines_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lines" ADD CONSTRAINT "inventory_lines_isbn_id_fkey" FOREIGN KEY ("isbn_id") REFERENCES "isbns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lines" ADD CONSTRAINT "inventory_lines_adjustment_movement_id_fkey" FOREIGN KEY ("adjustment_movement_id") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_discounts" ADD CONSTRAINT "customer_discounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_isbn_id_fkey" FOREIGN KEY ("isbn_id") REFERENCES "isbns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_isbn_id_fkey" FOREIGN KEY ("isbn_id") REFERENCES "isbns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_isbn_id_fkey" FOREIGN KEY ("isbn_id") REFERENCES "isbns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignments" ADD CONSTRAINT "consignments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignments" ADD CONSTRAINT "consignments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignments" ADD CONSTRAINT "consignments_isbn_id_fkey" FOREIGN KEY ("isbn_id") REFERENCES "isbns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignment_statements" ADD CONSTRAINT "consignment_statements_consignment_id_fkey" FOREIGN KEY ("consignment_id") REFERENCES "consignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_isbn_id_fkey" FOREIGN KEY ("isbn_id") REFERENCES "isbns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_origin_delivery_id_fkey" FOREIGN KEY ("origin_delivery_id") REFERENCES "deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "customer_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_isbn_id_fkey" FOREIGN KEY ("isbn_id") REFERENCES "isbns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

