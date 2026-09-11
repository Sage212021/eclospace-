-- Planification du projet (étape PLANIFICATION) : planning saisi dans Eclospace,
-- lié au manuscrit, document officiel généré. Remplace le dépôt d'un fichier.
CREATE TYPE "ProjectActivityPriority" AS ENUM ('basse', 'normale', 'haute');
CREATE TYPE "ProjectActivityStatus" AS ENUM ('a_faire', 'en_cours', 'termine');

CREATE TABLE "project_plans" (
  "id" TEXT NOT NULL,
  "manuscript_id" TEXT NOT NULL,
  "manager_name" TEXT,
  "start_date" TIMESTAMP(3),
  "end_date" TIMESTAMP(3),
  "objectives" TEXT,
  "notes" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "project_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_plans_manuscript_id_key" ON "project_plans"("manuscript_id");
ALTER TABLE "project_plans" ADD CONSTRAINT "project_plans_manuscript_id_fkey"
  FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "project_plan_activities" (
  "id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "responsible" TEXT,
  "start_date" TIMESTAMP(3),
  "end_date" TIMESTAMP(3),
  "priority" "ProjectActivityPriority" NOT NULL DEFAULT 'normale',
  "status" "ProjectActivityStatus" NOT NULL DEFAULT 'a_faire',
  "dependencies" TEXT,
  "observations" TEXT,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "project_plan_activities_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_plan_activities_plan_id_idx" ON "project_plan_activities"("plan_id");
ALTER TABLE "project_plan_activities" ADD CONSTRAINT "project_plan_activities_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "project_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
