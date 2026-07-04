/*
  Warnings:

  - You are about to drop the column `is_mobile_money` on the `bank_accounts` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ShippingZone" AS ENUM ('yaounde', 'douala', 'autres_villes_cameroun', 'international');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('banque', 'caisse', 'mobile_money');

-- AlterEnum
ALTER TYPE "ExpenseStatus" ADD VALUE 'en_attente_dg';

-- AlterTable
ALTER TABLE "bank_accounts" DROP COLUMN "is_mobile_money",
ADD COLUMN     "type" "BankAccountType" NOT NULL DEFAULT 'banque';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "shipping_zone" "ShippingZone";

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "finance_validated_by" TEXT;

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "shipping_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "shipping_fee_invoiced" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "shipping_rates" (
    "id" TEXT NOT NULL,
    "zone" "ShippingZone" NOT NULL,
    "flat_amount" DECIMAL(10,2),
    "per_kg_amount" DECIMAL(10,2),
    "free_above_amount" DECIMAL(10,2),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "shipping_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_transfers" (
    "id" TEXT NOT NULL,
    "from_account_id" TEXT NOT NULL,
    "to_account_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "transferred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "account_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipping_rates_zone_key" ON "shipping_rates"("zone");

-- AddForeignKey
ALTER TABLE "account_transfers" ADD CONSTRAINT "account_transfers_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transfers" ADD CONSTRAINT "account_transfers_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
