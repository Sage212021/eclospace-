-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('internal', 'external');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "account_type" "AccountType" NOT NULL DEFAULT 'internal',
ADD COLUMN     "partner_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_partner_id_key" ON "users"("partner_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
