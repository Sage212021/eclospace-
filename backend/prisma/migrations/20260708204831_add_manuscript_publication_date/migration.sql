-- AlterTable
ALTER TABLE "manuscripts" ADD COLUMN     "is_back_catalogue" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publication_date" TIMESTAMP(3);
