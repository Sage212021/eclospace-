-- Atelier de réécriture de SAGE (Lot C) : chaque proposition (original + texte
-- proposé + explication + mode) est tracée et horodatée, avec sa décision
-- (acceptée / refusée). L'original n'est jamais modifié en silence.
CREATE TABLE "ai_editorial_rewrites" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "instruction" TEXT,
    "source_text" TEXT NOT NULL,
    "proposed_text" TEXT NOT NULL DEFAULT '',
    "explanation" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "model" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    CONSTRAINT "ai_editorial_rewrites_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_editorial_rewrites_manuscript_id_idx" ON "ai_editorial_rewrites"("manuscript_id");

ALTER TABLE "ai_editorial_rewrites"
    ADD CONSTRAINT "ai_editorial_rewrites_manuscript_id_fkey"
    FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
