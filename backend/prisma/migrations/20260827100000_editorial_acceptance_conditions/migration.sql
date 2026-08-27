-- Audit éditorial, point n°2 : suivi des acceptations « sous conditions ».
-- Table additive ; aucune donnée existante touchée.
CREATE TABLE "editorial_acceptance_conditions" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "decision_id" TEXT,
    "label" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifted_at" TIMESTAMP(3),
    "lifted_by" TEXT,
    "lift_note" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "editorial_acceptance_conditions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "editorial_acceptance_conditions_manuscript_id_idx" ON "editorial_acceptance_conditions"("manuscript_id");
