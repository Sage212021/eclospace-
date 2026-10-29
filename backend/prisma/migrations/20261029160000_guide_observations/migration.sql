-- Observations d'amélioration suivables issues du Guide éditorial de SAGE (Phase 2).
CREATE TABLE "guide_observations" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "document_id" TEXT,
    "number" INTEGER NOT NULL DEFAULT 0,
    "code" TEXT NOT NULL,
    "title" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'importante',
    "location" TEXT,
    "recommendation" TEXT,
    "status" TEXT NOT NULL DEFAULT 'a_traiter',
    "note" TEXT,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "guide_observations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "guide_observations_manuscript_id_idx" ON "guide_observations"("manuscript_id");
