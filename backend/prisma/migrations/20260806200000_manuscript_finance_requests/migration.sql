-- Demandes Finance depuis la fiche manuscrit : devis / facture frais de dépôt.
CREATE TYPE "ManuscriptFinanceRequestType" AS ENUM ('devis', 'frais_depot');
CREATE TYPE "ManuscriptFinanceRequestStatus" AS ENUM ('requested', 'processed', 'rejected');

CREATE TABLE "manuscript_finance_requests" (
  "id" TEXT NOT NULL,
  "manuscript_id" TEXT NOT NULL,
  "type" "ManuscriptFinanceRequestType" NOT NULL,
  "status" "ManuscriptFinanceRequestStatus" NOT NULL DEFAULT 'requested',
  "note" TEXT,
  "requested_by" TEXT,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_by" TEXT,
  "processed_at" TIMESTAMP(3),
  "resolution" TEXT,
  CONSTRAINT "manuscript_finance_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "manuscript_finance_requests_status_idx" ON "manuscript_finance_requests"("status");
CREATE INDEX "manuscript_finance_requests_manuscript_id_idx" ON "manuscript_finance_requests"("manuscript_id");

ALTER TABLE "manuscript_finance_requests" ADD CONSTRAINT "manuscript_finance_requests_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
