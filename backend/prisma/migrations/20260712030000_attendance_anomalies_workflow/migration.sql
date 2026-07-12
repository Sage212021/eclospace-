-- Module « Présences » — incrément 4 : file d'anomalies + workflow de
-- validation paramétrable. Additif uniquement (deux tables + trois enums),
-- aucune donnée existante impactée. Réversible.

-- CreateEnum
CREATE TYPE "AttendanceAnomalyType" AS ENUM ('retard', 'depart_anticipe', 'absence', 'incoherence', 'absence_connexion', 'absence_deconnexion', 'duree_anormale');

-- CreateEnum
CREATE TYPE "AttendanceAnomalyStatus" AS ENUM ('en_attente', 'en_analyse', 'validee', 'rejetee', 'corrigee', 'annulee');

-- CreateEnum
CREATE TYPE "ValidationLevelMode" AS ENUM ('obligatoire', 'facultatif', 'desactive');

-- CreateTable
CREATE TABLE "attendance_anomalies" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "type" "AttendanceAnomalyType" NOT NULL,
    "minutes" INTEGER,
    "detail" TEXT,
    "status" "AttendanceAnomalyStatus" NOT NULL DEFAULT 'en_attente',
    "justification_motif" TEXT,
    "justification_comment" TEXT,
    "justification_document_id" TEXT,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "attendance_anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_validation_levels" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "mode" "ValidationLevelMode" NOT NULL DEFAULT 'obligatoire',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "attendance_validation_levels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_anomalies_status_idx" ON "attendance_anomalies"("status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_anomalies_employee_id_day_type_key" ON "attendance_anomalies"("employee_id", "day", "type");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_validation_levels_code_key" ON "attendance_validation_levels"("code");

-- AddForeignKey
ALTER TABLE "attendance_anomalies" ADD CONSTRAINT "attendance_anomalies_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
