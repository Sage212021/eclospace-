-- CreateEnum
CREATE TYPE "AuthorFileDirection" AS ENUM ('from_author', 'to_author');

-- CreateTable
CREATE TABLE "author_files" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "direction" "AuthorFileDirection" NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_mime" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,

    CONSTRAINT "author_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "author_files_manuscript_id_idx" ON "author_files"("manuscript_id");
CREATE INDEX "author_files_partner_id_idx" ON "author_files"("partner_id");

-- AddForeignKey
ALTER TABLE "author_files" ADD CONSTRAINT "author_files_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "author_files" ADD CONSTRAINT "author_files_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
