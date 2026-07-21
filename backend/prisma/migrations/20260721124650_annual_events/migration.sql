-- CreateEnum
CREATE TYPE "AnnualEventStatus" AS ENUM ('a_venir', 'a_confirmer', 'tenu', 'non_tenu');


-- CreateTable
CREATE TABLE "annual_events" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "location" TEXT,
    "dg_present" BOOLEAN NOT NULL DEFAULT false,
    "status" "AnnualEventStatus" NOT NULL DEFAULT 'a_venir',
    "affiche_file_path" TEXT,
    "affiche_mime_type" TEXT,
    "affiche_file_size" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "annual_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "annual_events_start_date_idx" ON "annual_events"("start_date");

