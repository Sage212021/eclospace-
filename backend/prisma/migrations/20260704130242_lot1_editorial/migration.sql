-- CreateEnum
CREATE TYPE "ManuscriptOrigin" AS ENUM ('soumission', 'commande');

-- CreateEnum
CREATE TYPE "ContributorRole" AS ENUM ('author', 'co_author', 'translator', 'illustrator', 'preface');

-- CreateEnum
CREATE TYPE "ReadingAssignmentStatus" AS ENUM ('pending', 'submitted', 'late', 'cancelled');

-- CreateEnum
CREATE TYPE "EvaluationRecommendation" AS ENUM ('accept', 'accept_minor', 'accept_major', 'rewrite', 'new_expertise', 'reject');

-- CreateEnum
CREATE TYPE "EvaluationRating" AS ENUM ('excellent', 'very_good', 'good', 'to_rework', 'refused');

-- CreateEnum
CREATE TYPE "EvaluationVisibility" AS ENUM ('confidentiel', 'direction_seule', 'comite', 'dossier_editorial');

-- CreateEnum
CREATE TYPE "EditorialDecisionType" AS ENUM ('acceptation', 'acceptation_conditions', 'revision', 'attente', 'refus');

-- CreateTable
CREATE TABLE "authors" (
    "id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "pen_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "bio" TEXT,
    "tax_status" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,

    CONSTRAINT "authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genres" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "genres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manuscripts" (
    "id" TEXT NOT NULL,
    "manuscript_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "collection_id" TEXT,
    "genre_id" TEXT,
    "language" TEXT NOT NULL,
    "estimated_pages" INTEGER,
    "summary" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "origin" "ManuscriptOrigin" NOT NULL DEFAULT 'soumission',
    "status_id" TEXT NOT NULL,
    "priority_score" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "priority_override" DECIMAL(6,2),
    "priority_override_justification" TEXT,
    "owner_id" TEXT NOT NULL,
    "project_manager_id" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "requires_expertise" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,

    CONSTRAINT "manuscripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_contributors" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "role" "ContributorRole" NOT NULL DEFAULT 'author',
    "display_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "work_contributors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_statuses" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "step_order" INTEGER NOT NULL,
    "department_id" TEXT,
    "is_conditional" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "workflow_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manuscript_steps" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "status_id" TEXT NOT NULL,
    "responsible_id" TEXT,
    "planned_start" TIMESTAMP(3),
    "planned_end" TIMESTAMP(3),
    "actual_start" TIMESTAMP(3),
    "actual_end" TIMESTAMP(3),
    "validation_by" TEXT,
    "validated_at" TIMESTAMP(3),
    "observations" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manuscript_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_transitions" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "from_status_code" TEXT,
    "to_status_code" TEXT NOT NULL,
    "from_department_id" TEXT,
    "to_department_id" TEXT,
    "responsible_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observations" TEXT,

    CONSTRAINT "step_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reading_assignments" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "reader_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMP(3) NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "status" "ReadingAssignmentStatus" NOT NULL DEFAULT 'pending',
    "extension_reason" TEXT,

    CONSTRAINT "reading_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_criteria" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "coefficient" DECIMAL(4,2) NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "evaluation_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluations" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "overall_comment" TEXT,
    "recommendation" "EvaluationRecommendation" NOT NULL,
    "global_score" DECIMAL(6,2) NOT NULL,
    "rating" "EvaluationRating" NOT NULL,
    "visibility" "EvaluationVisibility" NOT NULL DEFAULT 'comite',
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_scores" (
    "id" TEXT NOT NULL,
    "evaluation_id" TEXT NOT NULL,
    "criterion_id" TEXT NOT NULL,
    "score" DECIMAL(4,2) NOT NULL,
    "comment" TEXT,

    CONSTRAINT "evaluation_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editorial_decisions" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "decision" "EditorialDecisionType" NOT NULL,
    "decided_by" TEXT NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "motivation" TEXT NOT NULL,
    "score_gap_flag" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "editorial_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collections_code_key" ON "collections"("code");

-- CreateIndex
CREATE UNIQUE INDEX "genres_code_key" ON "genres"("code");

-- CreateIndex
CREATE UNIQUE INDEX "manuscripts_manuscript_number_key" ON "manuscripts"("manuscript_number");

-- CreateIndex
CREATE UNIQUE INDEX "work_contributors_manuscript_id_author_id_role_key" ON "work_contributors"("manuscript_id", "author_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_statuses_code_key" ON "workflow_statuses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "manuscript_steps_manuscript_id_status_id_key" ON "manuscript_steps"("manuscript_id", "status_id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluations_assignment_id_key" ON "evaluations"("assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_scores_evaluation_id_criterion_id_key" ON "evaluation_scores"("evaluation_id", "criterion_id");

-- AddForeignKey
ALTER TABLE "manuscripts" ADD CONSTRAINT "manuscripts_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manuscripts" ADD CONSTRAINT "manuscripts_genre_id_fkey" FOREIGN KEY ("genre_id") REFERENCES "genres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manuscripts" ADD CONSTRAINT "manuscripts_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "workflow_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manuscripts" ADD CONSTRAINT "manuscripts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manuscripts" ADD CONSTRAINT "manuscripts_project_manager_id_fkey" FOREIGN KEY ("project_manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_contributors" ADD CONSTRAINT "work_contributors_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_contributors" ADD CONSTRAINT "work_contributors_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_statuses" ADD CONSTRAINT "workflow_statuses_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manuscript_steps" ADD CONSTRAINT "manuscript_steps_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manuscript_steps" ADD CONSTRAINT "manuscript_steps_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "workflow_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manuscript_steps" ADD CONSTRAINT "manuscript_steps_responsible_id_fkey" FOREIGN KEY ("responsible_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_transitions" ADD CONSTRAINT "step_transitions_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_assignments" ADD CONSTRAINT "reading_assignments_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_assignments" ADD CONSTRAINT "reading_assignments_reader_id_fkey" FOREIGN KEY ("reader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "reading_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_scores" ADD CONSTRAINT "evaluation_scores_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_scores" ADD CONSTRAINT "evaluation_scores_criterion_id_fkey" FOREIGN KEY ("criterion_id") REFERENCES "evaluation_criteria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editorial_decisions" ADD CONSTRAINT "editorial_decisions_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editorial_decisions" ADD CONSTRAINT "editorial_decisions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
