-- Formation : demandes, sessions et suivi de participation.
CREATE TYPE "TrainingRequestStatus" AS ENUM ('demandee', 'approuvee', 'refusee', 'planifiee');
CREATE TYPE "TrainingSessionMode" AS ENUM ('presentiel', 'distanciel');
CREATE TYPE "TrainingSessionStatus" AS ENUM ('planifiee', 'realisee', 'annulee');
CREATE TYPE "TrainingParticipationStatus" AS ENUM ('inscrit', 'present', 'absent');

CREATE TABLE "training_requests" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "motivation" TEXT,
  "status" "TrainingRequestStatus" NOT NULL DEFAULT 'demandee',
  "decided_by" TEXT,
  "decided_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" TEXT,
  CONSTRAINT "training_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "training_requests_employee_id_idx" ON "training_requests"("employee_id");

CREATE TABLE "training_sessions" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "provider" TEXT,
  "theme" TEXT,
  "mode" "TrainingSessionMode" NOT NULL DEFAULT 'presentiel',
  "session_date" TIMESTAMP(3),
  "status" "TrainingSessionStatus" NOT NULL DEFAULT 'planifiee',
  "cost" DECIMAL(12,2),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" TEXT,
  CONSTRAINT "training_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "training_participations" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "status" "TrainingParticipationStatus" NOT NULL DEFAULT 'inscrit',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "training_participations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "training_participations_session_id_employee_id_key" ON "training_participations"("session_id", "employee_id");

ALTER TABLE "training_requests" ADD CONSTRAINT "training_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "training_participations" ADD CONSTRAINT "training_participations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "training_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "training_participations" ADD CONSTRAINT "training_participations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
