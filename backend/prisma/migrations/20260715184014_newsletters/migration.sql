-- CreateEnum
CREATE TYPE "NewsletterStatus" AS ENUM ('brouillon', 'envoyee');

-- CreateTable
CREATE TABLE "newsletters" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intro" TEXT,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "status" "NewsletterStatus" NOT NULL DEFAULT 'brouillon',
    "author_id" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3),
    "recipients" INTEGER,
    "items_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,

    CONSTRAINT "newsletters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "newsletters_status_idx" ON "newsletters"("status");

-- CreateIndex
CREATE INDEX "newsletters_period_start_idx" ON "newsletters"("period_start");

-- AddForeignKey
ALTER TABLE "newsletters" ADD CONSTRAINT "newsletters_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
