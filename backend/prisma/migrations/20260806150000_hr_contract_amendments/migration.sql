-- Avenants aux contrats de travail.
CREATE TABLE "hr_contract_amendments" (
  "id" TEXT NOT NULL,
  "contract_id" TEXT NOT NULL,
  "effective_date" TIMESTAMP(3) NOT NULL,
  "subject" TEXT NOT NULL,
  "description" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_contract_amendments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hr_contract_amendments_contract_id_idx" ON "hr_contract_amendments"("contract_id");
ALTER TABLE "hr_contract_amendments" ADD CONSTRAINT "hr_contract_amendments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "hr_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
