-- Fusion de fiches ouvrages : alias (merged_into_id) + journal des fusions.
ALTER TABLE "manuscripts" ADD COLUMN "merged_into_id" TEXT;
ALTER TABLE "manuscripts" ADD CONSTRAINT "manuscripts_merged_into_id_fkey"
  FOREIGN KEY ("merged_into_id") REFERENCES "manuscripts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "manuscript_merges" (
  "id"           TEXT NOT NULL,
  "keeper_id"    TEXT NOT NULL,
  "loser_id"     TEXT NOT NULL,
  "details"      JSONB NOT NULL,
  "performed_by" TEXT NOT NULL,
  "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "undone_at"    TIMESTAMP(3),
  "undone_by"    TEXT,
  CONSTRAINT "manuscript_merges_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "manuscript_merges_keeper_id_idx" ON "manuscript_merges"("keeper_id");
CREATE INDEX "manuscript_merges_loser_id_idx" ON "manuscript_merges"("loser_id");
