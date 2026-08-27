-- Stock & magasin : pièces officielles imprimables (Bon de réception de livres,
-- Retrait d'ouvrage auteur). Tables additives ; aucune donnée existante touchée.

CREATE TABLE "book_receipt_counters" (
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "book_receipt_counters_pkey" PRIMARY KEY ("year")
);

CREATE TABLE "book_receipt_vouchers" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "supplier" TEXT,
    "order_number" TEXT,
    "delivery_note" TEXT,
    "carrier" TEXT,
    "received_by_name" TEXT,
    "received_by_role" TEXT,
    "remarks" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "book_receipt_vouchers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "book_receipt_vouchers_number_key" ON "book_receipt_vouchers"("number");
CREATE INDEX "book_receipt_vouchers_received_at_idx" ON "book_receipt_vouchers"("received_at");

CREATE TABLE "book_receipt_lines" (
    "id" TEXT NOT NULL,
    "voucher_id" TEXT NOT NULL,
    "isbn_id" TEXT,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "qty_ordered" INTEGER,
    "qty_received" INTEGER,
    "qty_good" INTEGER,
    "qty_damaged" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "book_receipt_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "book_receipt_lines_voucher_id_idx" ON "book_receipt_lines"("voucher_id");

ALTER TABLE "book_receipt_lines" ADD CONSTRAINT "book_receipt_lines_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "book_receipt_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "AuthorWithdrawalMotive" AS ENUM ('contractuel', 'achat_remise', 'restitution_stock', 'autre');

CREATE TABLE "author_withdrawal_counters" (
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "author_withdrawal_counters_pkey" PRIMARY KEY ("year")
);

CREATE TABLE "author_withdrawal_vouchers" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "place" TEXT,
    "author_name" TEXT NOT NULL,
    "author_address" TEXT,
    "author_phone" TEXT,
    "author_email" TEXT,
    "work_title" TEXT NOT NULL,
    "isbn_id" TEXT,
    "quantity" INTEGER NOT NULL,
    "motive" "AuthorWithdrawalMotive" NOT NULL,
    "motive_other" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "author_withdrawal_vouchers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "author_withdrawal_vouchers_number_key" ON "author_withdrawal_vouchers"("number");
CREATE INDEX "author_withdrawal_vouchers_issued_at_idx" ON "author_withdrawal_vouchers"("issued_at");
