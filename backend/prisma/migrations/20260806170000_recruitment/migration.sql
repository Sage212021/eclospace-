-- Recrutement : postes à pourvoir et candidatures.
CREATE TYPE "JobOpeningStatus" AS ENUM ('ouvert', 'pourvu', 'annule');
CREATE TYPE "JobApplicationStatus" AS ENUM ('recue', 'entretien', 'retenue', 'refusee');

CREATE TABLE "job_openings" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "department_id" TEXT,
  "contract_type" "HrContractType",
  "description" TEXT,
  "status" "JobOpeningStatus" NOT NULL DEFAULT 'ouvert',
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" TEXT,
  CONSTRAINT "job_openings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_applications" (
  "id" TEXT NOT NULL,
  "job_opening_id" TEXT NOT NULL,
  "first_name" TEXT NOT NULL,
  "last_name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "source" TEXT,
  "status" "JobApplicationStatus" NOT NULL DEFAULT 'recue',
  "notes" TEXT,
  "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" TEXT,
  CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "job_applications_job_opening_id_idx" ON "job_applications"("job_opening_id");

ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_job_opening_id_fkey" FOREIGN KEY ("job_opening_id") REFERENCES "job_openings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
