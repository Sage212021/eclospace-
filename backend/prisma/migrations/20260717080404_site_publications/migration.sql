-- CreateEnum
CREATE TYPE "SitePublicationStatus" AS ENUM ('non_publie', 'publie', 'erreur');

-- CreateTable
CREATE TABLE "site_publications" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "status" "SitePublicationStatus" NOT NULL DEFAULT 'non_publie',
    "external_id" TEXT,
    "external_url" TEXT,
    "last_payload" JSONB,
    "last_error" TEXT,
    "published_at" TIMESTAMP(3),
    "published_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "site_publications_manuscript_id_key" ON "site_publications"("manuscript_id");

-- CreateIndex
CREATE INDEX "site_publications_status_idx" ON "site_publications"("status");

-- AddForeignKey
ALTER TABLE "site_publications" ADD CONSTRAINT "site_publications_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
