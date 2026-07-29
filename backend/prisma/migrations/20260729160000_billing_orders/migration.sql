-- CreateEnum
CREATE TYPE "BillingOrderStatus" AS ENUM ('pending', 'invoiced', 'cancelled');
CREATE TYPE "BillingOrderCategory" AS ENUM ('livre_scolaire', 'autre');

-- CreateTable
CREATE TABLE "billing_orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "category" "BillingOrderCategory" NOT NULL DEFAULT 'livre_scolaire',
    "label" TEXT NOT NULL,
    "amount_ht" DECIMAL(12,2) NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" "BillingOrderStatus" NOT NULL DEFAULT 'pending',
    "initiated_by" TEXT,
    "invoice_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "billing_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_order_number_counters" (
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "billing_order_number_counters_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_orders_order_number_key" ON "billing_orders"("order_number");
CREATE UNIQUE INDEX "billing_orders_invoice_id_key" ON "billing_orders"("invoice_id");
CREATE INDEX "billing_orders_status_idx" ON "billing_orders"("status");

-- AddForeignKey
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
