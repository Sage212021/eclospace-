-- Lot 4 : moteur d'apprentissage sous contrôle.
ALTER TABLE "ai_knowledge" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'dg';
ALTER TABLE "ai_knowledge" ADD COLUMN "rationale" TEXT;

CREATE TABLE "ai_learning_runs" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "summary" TEXT NOT NULL DEFAULT '',
  "proposal_count" INTEGER NOT NULL DEFAULT 0,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_learning_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_learning_runs_owner_id_idx" ON "ai_learning_runs"("owner_id");
