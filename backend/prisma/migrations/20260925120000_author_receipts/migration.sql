-- Paiements auteurs & Reçus (module éditorial ↔ finance).
-- Le reçu est l'opération financière centrale (source unique), immuable.

-- CreateEnum
CREATE TYPE "AuthorReceiptType" AS ENUM ('frais_depot', 'prestation_editoriale');

-- CreateEnum
CREATE TYPE "AuthorReceiptStatus" AS ENUM ('enregistre', 'a_controler', 'controle', 'comptabilise', 'annule');

-- CreateTable : séquence de numérotation des reçus (REC-AAAA-NNNNNN).
CREATE TABLE "receipt_number_counters" (
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "receipt_number_counters_pkey" PRIMARY KEY ("year")
);

-- CreateTable : reçus de paiement auteur.
CREATE TABLE "author_receipts" (
    "id" TEXT NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "type" "AuthorReceiptType" NOT NULL,
    "status" "AuthorReceiptStatus" NOT NULL DEFAULT 'enregistre',
    "partner_id" TEXT NOT NULL,
    "manuscript_id" TEXT,
    "service_label" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XAF',
    "method" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "tx_reference" TEXT,
    "comment" TEXT,
    "initiated_by" TEXT,
    "initiated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_by" TEXT,
    "generated_at" TIMESTAMP(3),
    "controlled_by" TEXT,
    "controlled_at" TIMESTAMP(3),
    "accounted_by" TEXT,
    "accounted_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "replaced_by_receipt_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "author_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "author_receipts_receipt_number_key" ON "author_receipts"("receipt_number");
CREATE INDEX "author_receipts_partner_id_idx" ON "author_receipts"("partner_id");
CREATE INDEX "author_receipts_manuscript_id_idx" ON "author_receipts"("manuscript_id");
CREATE INDEX "author_receipts_status_idx" ON "author_receipts"("status");
CREATE INDEX "author_receipts_type_idx" ON "author_receipts"("type");
CREATE INDEX "author_receipts_paid_at_idx" ON "author_receipts"("paid_at");

-- AddForeignKey
ALTER TABLE "author_receipts" ADD CONSTRAINT "author_receipts_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "author_receipts" ADD CONSTRAINT "author_receipts_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
