-- CreateEnum
CREATE TYPE "PointOfSaleType" AS ENUM ('librairie', 'salon', 'en_ligne', 'autre');

-- AlterTable
ALTER TABLE "pos_sales" ADD COLUMN     "point_of_sale_id" TEXT;


-- CreateTable
CREATE TABLE "points_of_sale" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PointOfSaleType" NOT NULL DEFAULT 'librairie',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "points_of_sale_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_point_of_sale_id_fkey" FOREIGN KEY ("point_of_sale_id") REFERENCES "points_of_sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

