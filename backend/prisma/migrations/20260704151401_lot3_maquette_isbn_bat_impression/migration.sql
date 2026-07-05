-- CreateEnum
CREATE TYPE "ChecklistContext" AS ENUM ('structure_ouvrage', 'bat', 'isbn_completeness');

-- CreateEnum
CREATE TYPE "ImageAssetType" AS ENUM ('couverture_1', 'couverture_4', 'dos', 'rabat', 'illustration_interieure', 'visuel_marketing');

-- CreateEnum
CREATE TYPE "RightsOrigin" AS ENUM ('creation_interne', 'banque_images', 'fourni_par_auteur');

-- CreateEnum
CREATE TYPE "IsbnFormat" AS ENUM ('print', 'epub', 'pdf', 'audio');

-- CreateEnum
CREATE TYPE "IsbnStatus" AS ENUM ('available', 'reserved', 'assigned', 'published');

-- CreateEnum
CREATE TYPE "LegalDepositStatus" AS ENUM ('a_preparer', 'depose', 'accuse_reception');

-- CreateEnum
CREATE TYPE "MetadataExportFormat" AS ENUM ('onix30', 'csv');

-- CreateEnum
CREATE TYPE "BatStatus" AS ENUM ('in_control', 'corrections_requested', 'awaiting_signature', 'signed', 'cancelled');

-- CreateEnum
CREATE TYPE "AnomalySeverity" AS ENUM ('minor', 'major', 'blocking');

-- CreateEnum
CREATE TYPE "PrintQuoteStatus" AS ENUM ('requested', 'received', 'selected', 'declined');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('draft', 'approved', 'sent', 'in_production', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "ProductionMilestoneType" AS ENUM ('files_received', 'setup', 'printing', 'finishing', 'shipped', 'delivered');

-- CreateEnum
CREATE TYPE "QcVerdict" AS ENUM ('conform', 'with_reserves', 'non_conform');

-- CreateTable
CREATE TABLE "layout_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "collection_id" TEXT,
    "format" TEXT NOT NULL,
    "specs" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "layout_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graphic_charters" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "collection_id" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "graphic_charters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_specs" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "trim_format" TEXT,
    "final_pages" INTEGER,
    "paper_interior" TEXT,
    "paper_interior_gsm" INTEGER,
    "paper_cover" TEXT,
    "binding" TEXT,
    "lamination" TEXT,
    "spine_width_mm" DECIMAL(6,2),
    "spine_needs_recalc" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "production_specs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklists" (
    "id" TEXT NOT NULL,
    "context" "ChecklistContext" NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_items" (
    "id" TEXT NOT NULL,
    "checklist_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_blocking" BOOLEAN NOT NULL DEFAULT true,
    "not_applicable" BOOLEAN NOT NULL DEFAULT false,
    "checked_by" TEXT,
    "checked_at" TIMESTAMP(3),
    "observation" TEXT,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_assets" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "type" "ImageAssetType" NOT NULL,
    "placement" TEXT,
    "resolution_dpi" INTEGER,
    "color_mode" TEXT,
    "technical_ok" BOOLEAN NOT NULL DEFAULT false,
    "rights_origin" "RightsOrigin",
    "rights_license" TEXT,
    "rights_credit" TEXT,
    "document_version_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "image_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "isbn_pool" (
    "id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "digit_width" INTEGER NOT NULL DEFAULT 3,
    "range_start" INTEGER NOT NULL,
    "range_end" INTEGER NOT NULL,
    "next_value" INTEGER NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "isbn_pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "isbns" (
    "id" TEXT NOT NULL,
    "isbn13" TEXT NOT NULL,
    "pool_id" TEXT,
    "manuscript_id" TEXT,
    "format" "IsbnFormat" NOT NULL,
    "status" "IsbnStatus" NOT NULL DEFAULT 'available',
    "assigned_at" TIMESTAMP(3),
    "assigned_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "isbns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_deposits" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "depository" TEXT NOT NULL,
    "copies_required" INTEGER NOT NULL,
    "due_date" TIMESTAMP(3),
    "deposited_at" TIMESTAMP(3),
    "receipt_document_id" TEXT,
    "deposit_number" TEXT,
    "status" "LegalDepositStatus" NOT NULL DEFAULT 'a_preparer',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_metadata" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "weight_grams" INTEGER,
    "summary" TEXT,
    "author_bio" TEXT,
    "public_target" TEXT,
    "age_range" TEXT,
    "thema_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "price_by_country" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "work_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metadata_exports" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "partner_id" TEXT,
    "format" "MetadataExportFormat" NOT NULL,
    "metadata_version" INTEGER NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "needs_resend" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "metadata_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bat_records" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "BatStatus" NOT NULL DEFAULT 'in_control',
    "interior_version_id" TEXT,
    "cover_version_id" TEXT,
    "technical_sheet" JSONB,

    CONSTRAINT "bat_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bat_anomalies" (
    "id" TEXT NOT NULL,
    "bat_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "severity" "AnomalySeverity" NOT NULL,
    "returned_to" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bat_anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bat_signatures" (
    "id" TEXT NOT NULL,
    "bat_id" TEXT NOT NULL,
    "signer_id" TEXT NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "files_hash" TEXT NOT NULL,
    "author_approval" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "bat_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printers" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "payment_terms" TEXT,

    CONSTRAINT "printers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_quotes" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "printer_id" TEXT NOT NULL,
    "quantities" JSONB NOT NULL,
    "amounts" JSONB,
    "lead_time_days" INTEGER,
    "valid_until" TIMESTAMP(3),
    "status" "PrintQuoteStatus" NOT NULL DEFAULT 'requested',
    "selection_motive" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "print_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "printer_id" TEXT NOT NULL,
    "po_number" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "delivery_due" TIMESTAMP(3),
    "delivery_location" TEXT,
    "quantity_tolerance_pct" DECIMAL(5,2),
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'draft',
    "approved_by" TEXT,
    "files_hash_reference" TEXT,
    "reprint_number" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_milestones" (
    "id" TEXT NOT NULL,
    "po_id" TEXT NOT NULL,
    "milestone" "ProductionMilestoneType" NOT NULL,
    "planned_at" TIMESTAMP(3),
    "actual_at" TIMESTAMP(3),

    CONSTRAINT "production_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "po_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quantity_received" INTEGER NOT NULL,
    "variance" INTEGER NOT NULL DEFAULT 0,
    "qc_verdict" "QcVerdict",

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_claims" (
    "id" TEXT NOT NULL,
    "receipt_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "resolution" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_specs_manuscript_id_key" ON "production_specs"("manuscript_id");

-- CreateIndex
CREATE UNIQUE INDEX "isbns_isbn13_key" ON "isbns"("isbn13");

-- CreateIndex
CREATE UNIQUE INDEX "work_metadata_manuscript_id_key" ON "work_metadata"("manuscript_id");

-- CreateIndex
CREATE UNIQUE INDEX "bat_records_manuscript_id_cycle_number_key" ON "bat_records"("manuscript_id", "cycle_number");

-- CreateIndex
CREATE UNIQUE INDEX "printers_partner_id_key" ON "printers"("partner_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_quote_id_key" ON "purchase_orders"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_po_number_key" ON "purchase_orders"("po_number");

-- CreateIndex
CREATE UNIQUE INDEX "production_milestones_po_id_milestone_key" ON "production_milestones"("po_id", "milestone");

-- AddForeignKey
ALTER TABLE "layout_templates" ADD CONSTRAINT "layout_templates_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graphic_charters" ADD CONSTRAINT "graphic_charters_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_specs" ADD CONSTRAINT "production_specs_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "checklists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_assets" ADD CONSTRAINT "image_assets_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_assets" ADD CONSTRAINT "image_assets_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "isbns" ADD CONSTRAINT "isbns_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "isbn_pool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "isbns" ADD CONSTRAINT "isbns_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_deposits" ADD CONSTRAINT "legal_deposits_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_metadata" ADD CONSTRAINT "work_metadata_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metadata_exports" ADD CONSTRAINT "metadata_exports_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metadata_exports" ADD CONSTRAINT "metadata_exports_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bat_records" ADD CONSTRAINT "bat_records_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bat_records" ADD CONSTRAINT "bat_records_interior_version_id_fkey" FOREIGN KEY ("interior_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bat_records" ADD CONSTRAINT "bat_records_cover_version_id_fkey" FOREIGN KEY ("cover_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bat_anomalies" ADD CONSTRAINT "bat_anomalies_bat_id_fkey" FOREIGN KEY ("bat_id") REFERENCES "bat_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bat_signatures" ADD CONSTRAINT "bat_signatures_bat_id_fkey" FOREIGN KEY ("bat_id") REFERENCES "bat_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bat_signatures" ADD CONSTRAINT "bat_signatures_signer_id_fkey" FOREIGN KEY ("signer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printers" ADD CONSTRAINT "printers_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_quotes" ADD CONSTRAINT "print_quotes_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_quotes" ADD CONSTRAINT "print_quotes_printer_id_fkey" FOREIGN KEY ("printer_id") REFERENCES "printers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "print_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_printer_id_fkey" FOREIGN KEY ("printer_id") REFERENCES "printers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_milestones" ADD CONSTRAINT "production_milestones_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_claims" ADD CONSTRAINT "supplier_claims_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
