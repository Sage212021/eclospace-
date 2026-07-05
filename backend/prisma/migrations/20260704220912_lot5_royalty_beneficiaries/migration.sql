-- CreateEnum
CREATE TYPE "StatementPeriodicity" AS ENUM ('mensuelle', 'trimestrielle', 'semestrielle', 'annuelle');

-- AlterTable
ALTER TABLE "royalty_payments" ADD COLUMN     "partner_id" TEXT;

-- AlterTable
ALTER TABLE "royalty_terms" ADD COLUMN     "statement_periodicity" "StatementPeriodicity",
ADD COLUMN     "tax_withholding_pct" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "contract_beneficiaries" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "share_pct" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "contract_beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_beneficiaries_contract_id_partner_id_key" ON "contract_beneficiaries"("contract_id", "partner_id");

-- AddForeignKey
ALTER TABLE "contract_beneficiaries" ADD CONSTRAINT "contract_beneficiaries_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_beneficiaries" ADD CONSTRAINT "contract_beneficiaries_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "royalty_payments" ADD CONSTRAINT "royalty_payments_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
