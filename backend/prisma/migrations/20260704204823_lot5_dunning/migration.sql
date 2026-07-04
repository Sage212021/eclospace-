-- CreateEnum
CREATE TYPE "DunningLevel" AS ENUM ('rappel', 'mise_en_demeure');

-- CreateTable
CREATE TABLE "dunnings" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "level" "DunningLevel" NOT NULL,
    "outstanding_amount" DECIMAL(12,2) NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "dunnings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "dunnings" ADD CONSTRAINT "dunnings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
