-- Cas B : demande de création/complétion de fiche pour un ouvrage reçu absent du catalogue.
CREATE TABLE "stock_fiche_requests" (
  "id" TEXT NOT NULL,
  "requested_by" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "title" TEXT NOT NULL,
  "author_name" TEXT,
  "isbn" TEXT,
  "collection" TEXT,
  "format" TEXT,
  "provenance" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "location_id" TEXT,
  "observations" TEXT,
  "manuscript_id" TEXT,
  "resolved_by" TEXT,
  "resolved_at" TIMESTAMP(3),
  "reject_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_fiche_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "stock_fiche_requests_status_idx" ON "stock_fiche_requests"("status");
