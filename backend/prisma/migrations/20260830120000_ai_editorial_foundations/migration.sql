-- IA éditoriale (Lot IA-0) : bibliothèque de prompts + journal de traçabilité.
-- Migration additive : aucune table existante n'est modifiée.

-- CreateEnum
CREATE TYPE "AiWorkType" AS ENUM ('evaluation', 'correction_1', 'correction_2', 'couverture');

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('en_attente', 'en_cours', 'termine', 'erreur');

-- CreateTable
CREATE TABLE "ai_prompts" (
    "id" TEXT NOT NULL,
    "work_type" "AiWorkType" NOT NULL,
    "label" TEXT NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "user_template" TEXT NOT NULL,
    "report_template" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "ai_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_reading_jobs" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "work_type" "AiWorkType" NOT NULL,
    "step_code" TEXT,
    "manuscript_version_ref" TEXT,
    "prompt_key" TEXT NOT NULL,
    "prompt_version" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "editor_recommendation" TEXT,
    "status" "AiJobStatus" NOT NULL DEFAULT 'en_attente',
    "cost_estimate" DECIMAL(12,2),
    "report_version" INTEGER,
    "produced_document_ids" JSONB,
    "error_message" TEXT,
    "launched_by" TEXT,
    "launched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "ai_reading_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompts_work_type_key" ON "ai_prompts"("work_type");

-- CreateIndex
CREATE INDEX "ai_reading_jobs_manuscript_id_idx" ON "ai_reading_jobs"("manuscript_id");

-- CreateIndex
CREATE INDEX "ai_reading_jobs_work_type_idx" ON "ai_reading_jobs"("work_type");
