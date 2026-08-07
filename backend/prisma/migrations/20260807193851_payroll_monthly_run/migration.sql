-- CreateEnum
CREATE TYPE "PayrollMonthlyStatus" AS ENUM ('brouillon', 'valide');

-- CreateTable
CREATE TABLE "payroll_monthly_runs" (
    "id" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "status" "PayrollMonthlyStatus" NOT NULL DEFAULT 'brouillon',
    "prepared_by" TEXT,
    "validated_by" TEXT,
    "validated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_monthly_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_monthly_lines" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "primes" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "heures_sup" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "retenue_absence" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "retard" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "avance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pret" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sanction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "autres" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_monthly_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_monthly_runs_period_key_key" ON "payroll_monthly_runs"("period_key");

-- CreateIndex
CREATE INDEX "payroll_monthly_lines_employee_id_idx" ON "payroll_monthly_lines"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_monthly_lines_run_id_employee_id_key" ON "payroll_monthly_lines"("run_id", "employee_id");

-- AddForeignKey
ALTER TABLE "payroll_monthly_lines" ADD CONSTRAINT "payroll_monthly_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_monthly_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_monthly_lines" ADD CONSTRAINT "payroll_monthly_lines_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
