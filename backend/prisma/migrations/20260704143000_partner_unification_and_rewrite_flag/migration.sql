-- CreateEnum
CREATE TYPE "PartnerCategory" AS ENUM ('auteur', 'correcteur', 'traducteur', 'illustrateur', 'maquettiste', 'graphiste', 'imprimeur', 'consultant', 'autre');

-- DropForeignKey
ALTER TABLE "contracts" DROP CONSTRAINT "contracts_author_id_fkey";

-- DropForeignKey
ALTER TABLE "work_contributors" DROP CONSTRAINT "work_contributors_author_id_fkey";

-- DropIndex
DROP INDEX "work_contributors_manuscript_id_author_id_role_key";

-- AlterTable
ALTER TABLE "contracts" DROP COLUMN "author_id",
ADD COLUMN     "partner_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "manuscripts" ADD COLUMN     "requires_rewrite" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "work_contributors" DROP COLUMN "author_id",
ADD COLUMN     "partner_id" TEXT NOT NULL;

-- DropTable
DROP TABLE "authors";

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "category" "PartnerCategory" NOT NULL DEFAULT 'auteur',
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "pen_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "bio" TEXT,
    "tax_status" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_contributors_manuscript_id_partner_id_role_key" ON "work_contributors"("manuscript_id", "partner_id", "role");

-- AddForeignKey
ALTER TABLE "work_contributors" ADD CONSTRAINT "work_contributors_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

