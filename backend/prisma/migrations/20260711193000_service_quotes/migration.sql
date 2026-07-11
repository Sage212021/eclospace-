-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('editorial', 'impression', 'communication');

-- DropForeignKey
ALTER TABLE "editorial_quotes" DROP CONSTRAINT "editorial_quotes_partner_id_fkey";

-- AlterTable
ALTER TABLE "editorial_quotes" ADD COLUMN     "customer_id" TEXT,
ADD COLUMN     "service_type" "ServiceType" NOT NULL DEFAULT 'editorial',
ALTER COLUMN "partner_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "editorial_quotes" ADD CONSTRAINT "editorial_quotes_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editorial_quotes" ADD CONSTRAINT "editorial_quotes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

