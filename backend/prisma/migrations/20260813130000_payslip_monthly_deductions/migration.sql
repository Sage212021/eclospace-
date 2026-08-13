-- Retenues du mois du bulletin unitaire, mémorisées par employé et par mois
-- (demande opérateur 13/08/2026). Table additive uniquement.
CREATE TABLE "payslip_monthly_deductions" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "retenue_absence" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "avance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pret" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "retard" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "autres" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payslip_monthly_deductions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payslip_monthly_deductions_employee_id_period_key_key" ON "payslip_monthly_deductions"("employee_id", "period_key");

ALTER TABLE "payslip_monthly_deductions" ADD CONSTRAINT "payslip_monthly_deductions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
