-- Cycle de correction éditoriale (global, ouvert jusqu'à la validation finale)
-- + historique des mouvements (itérations : dépôts, réaffectations, clôture).

-- CreateEnum
CREATE TYPE "CorrectionCycleStatus" AS ENUM ('en_cours', 'terminee');

-- CreateTable
CREATE TABLE "correction_cycles" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "CorrectionCycleStatus" NOT NULL DEFAULT 'en_cours',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_by" TEXT,
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "closure_note" TEXT,
    "final_version_id" TEXT,

    CONSTRAINT "correction_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correction_cycle_movements" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "user_id" TEXT,
    "user_role" TEXT,
    "recipient_id" TEXT,
    "motive" TEXT,
    "observations" TEXT,
    "document_version_id" TEXT,
    "step_status" TEXT,

    CONSTRAINT "correction_cycle_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "correction_cycles_reference_key" ON "correction_cycles"("reference");
CREATE UNIQUE INDEX "correction_cycles_manuscript_id_cycle_number_key" ON "correction_cycles"("manuscript_id", "cycle_number");
CREATE INDEX "correction_cycles_manuscript_id_status_idx" ON "correction_cycles"("manuscript_id", "status");
CREATE INDEX "correction_cycle_movements_cycle_id_at_idx" ON "correction_cycle_movements"("cycle_id", "at");

-- AddForeignKey
ALTER TABLE "correction_cycles" ADD CONSTRAINT "correction_cycles_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "correction_cycle_movements" ADD CONSTRAINT "correction_cycle_movements_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "correction_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
