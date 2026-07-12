-- Module Paie (D-007) — incrément 2 : fiche paie de l'employé (1-1). Additif.


-- CreateTable
CREATE TABLE "payroll_employee_profiles" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "matricule" TEXT,
    "cnps_number" TEXT,
    "niu" TEXT,
    "category" TEXT,
    "payment_mode" TEXT,
    "account_number" TEXT,
    "gross_contractual" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "base_pct" DECIMAL(6,4) NOT NULL DEFAULT 1,
    "fiscal_base" DECIMAL(12,2),
    "fiscal_parts" DECIMAL(4,1) NOT NULL DEFAULT 1,
    "apply_fiscal_parts" BOOLEAN NOT NULL DEFAULT true,
    "seniority_years" INTEGER NOT NULL DEFAULT 0,
    "seniority_rate" DECIMAL(6,4),
    "seniority_threshold" INTEGER,
    "apply_seniority" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "payroll_employee_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_employee_profiles_employee_id_key" ON "payroll_employee_profiles"("employee_id");

-- AddForeignKey
ALTER TABLE "payroll_employee_profiles" ADD CONSTRAINT "payroll_employee_profiles_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

