-- Bon de commande (fournisseur / imprimeur) — pièce officielle du pôle Stock & magasin.
CREATE TABLE "purchase_order_voucher_counters" (
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "purchase_order_voucher_counters_pkey" PRIMARY KEY ("year")
);

CREATE TABLE "purchase_order_vouchers" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "ordered_at" TIMESTAMP(3) NOT NULL,
    "supplier" TEXT NOT NULL,
    "supplier_address" TEXT,
    "supplier_contact" TEXT,
    "quote_ref" TEXT,
    "delivery_place" TEXT,
    "delivery_due" TIMESTAMP(3),
    "payment_terms" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'XAF',
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "issued_by_name" TEXT,
    "issued_by_role" TEXT,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "purchase_order_vouchers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_order_vouchers_number_key" ON "purchase_order_vouchers"("number");
CREATE INDEX "purchase_order_vouchers_ordered_at_idx" ON "purchase_order_vouchers"("ordered_at");

CREATE TABLE "purchase_order_voucher_lines" (
    "id" TEXT NOT NULL,
    "voucher_id" TEXT NOT NULL,
    "isbn_id" TEXT,
    "designation" TEXT NOT NULL,
    "specs" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_price_ht" DECIMAL(12,2) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "purchase_order_voucher_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "purchase_order_voucher_lines_voucher_id_idx" ON "purchase_order_voucher_lines"("voucher_id");

ALTER TABLE "purchase_order_voucher_lines" ADD CONSTRAINT "purchase_order_voucher_lines_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "purchase_order_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
