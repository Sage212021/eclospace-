-- CreateEnum
CREATE TYPE "EditorialQuoteStatus" AS ENUM ('draft', 'sent', 'accepted', 'refused', 'expired', 'invoiced');

-- CreateEnum
CREATE TYPE "QuoteAcceptanceMethod" AS ENUM ('online_link', 'internal', 'paper');

-- AlterEnum
ALTER TYPE "CustomerCategory" ADD VALUE 'auteur';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "partner_id" TEXT;

-- CreateTable
CREATE TABLE "editorial_quotes" (
    "id" TEXT NOT NULL,
    "quote_number" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "manuscript_id" TEXT,
    "status" "EditorialQuoteStatus" NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL DEFAULT 'XAF',
    "total_ht" DECIMAL(12,2) NOT NULL,
    "total_tax" DECIMAL(12,2) NOT NULL,
    "total_ttc" DECIMAL(12,2) NOT NULL,
    "valid_until" TIMESTAMP(3),
    "notes" TEXT,
    "exclusions_note" TEXT,
    "sign_token" TEXT,
    "sign_token_expires_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "acceptance_method" "QuoteAcceptanceMethod",
    "signer_name" TEXT,
    "terms_hash" TEXT,
    "acceptance_note" TEXT,
    "acceptance_ip" TEXT,
    "invoice_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "editorial_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editorial_quote_lines" (
    "id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "editorial_quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "editorial_quotes_quote_number_key" ON "editorial_quotes"("quote_number");

-- CreateIndex
CREATE UNIQUE INDEX "editorial_quotes_sign_token_key" ON "editorial_quotes"("sign_token");

-- CreateIndex
CREATE UNIQUE INDEX "editorial_quotes_invoice_id_key" ON "editorial_quotes"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_partner_id_key" ON "customers"("partner_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editorial_quotes" ADD CONSTRAINT "editorial_quotes_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editorial_quotes" ADD CONSTRAINT "editorial_quotes_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editorial_quotes" ADD CONSTRAINT "editorial_quotes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editorial_quote_lines" ADD CONSTRAINT "editorial_quote_lines_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "editorial_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

