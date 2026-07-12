-- Module « Présences » — incrément 6 : consolidation vers la paie. Additif :
-- deux colonnes nullable sur payroll_variables (aucune donnée impactée), un
-- enum et trois tables. Réversible.

-- CreateEnum
CREATE TYPE "AttendancePayrollStatus" AS ENUM ('brouillon', 'valide', 'gele', 'transmis');

-- AlterTable
ALTER TABLE "payroll_variables" ADD COLUMN     "deduction_amount" DECIMAL(12,2),
ADD COLUMN     "overtime_minutes" INTEGER;

-- CreateTable
CREATE TABLE "attendance_payroll_rubrics" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "attendance_payroll_rubrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_payroll_periods" (
    "id" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "status" "AttendancePayrollStatus" NOT NULL DEFAULT 'brouillon',
    "mode" TEXT NOT NULL DEFAULT 'manuel',
    "prepared_by" TEXT,
    "validated_by" TEXT,
    "validated_at" TIMESTAMP(3),
    "frozen_at" TIMESTAMP(3),
    "transmitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_payroll_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_payroll_lines" (
    "id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "worked_minutes" INTEGER NOT NULL,
    "late_minutes" INTEGER NOT NULL,
    "early_leave_minutes" INTEGER NOT NULL,
    "overtime_minutes" INTEGER NOT NULL,
    "days_worked" INTEGER NOT NULL,
    "days_absent_unjustified" INTEGER NOT NULL,
    "days_absent_justified" INTEGER NOT NULL,
    "deduction_proposed" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_payroll_rubrics_code_key" ON "attendance_payroll_rubrics"("code");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_payroll_periods_period_key_key" ON "attendance_payroll_periods"("period_key");

-- CreateIndex
CREATE INDEX "attendance_payroll_lines_employee_id_idx" ON "attendance_payroll_lines"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_payroll_lines_period_id_employee_id_key" ON "attendance_payroll_lines"("period_id", "employee_id");

-- AddForeignKey
ALTER TABLE "attendance_payroll_lines" ADD CONSTRAINT "attendance_payroll_lines_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "attendance_payroll_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_payroll_lines" ADD CONSTRAINT "attendance_payroll_lines_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
