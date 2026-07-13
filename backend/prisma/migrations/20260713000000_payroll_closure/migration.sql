-- Paie (D-007) — incrément 5 : clôture mensuelle (livre → journal immuable).


-- CreateTable
CREATE TABLE "payroll_closures" (
    "id" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "employees" INTEGER NOT NULL,
    "total_brut" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_net" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_charges_pat" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rate_effective_from" DATE NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by" TEXT,

    CONSTRAINT "payroll_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_journal_lines" (
    "id" TEXT NOT NULL,
    "closure_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "employee_name" TEXT NOT NULL,
    "matricule" TEXT,
    "cnps_number" TEXT,
    "niu" TEXT,
    "salaire_brut" DECIMAL(12,2) NOT NULL,
    "assiette_cnps" DECIMAL(12,2) NOT NULL,
    "pvid_salarie" DECIMAL(12,2) NOT NULL,
    "pvid_patronal" DECIMAL(12,2) NOT NULL,
    "prestations_familiales" DECIMAL(12,2) NOT NULL,
    "accidents_travail" DECIMAL(12,2) NOT NULL,
    "cfc_salarie" DECIMAL(12,2) NOT NULL,
    "cfc_patronal" DECIMAL(12,2) NOT NULL,
    "fne" DECIMAL(12,2) NOT NULL,
    "taxe_communale" DECIMAL(12,2) NOT NULL,
    "rav" DECIMAL(12,2) NOT NULL,
    "irpp_cac" DECIMAL(12,2) NOT NULL,
    "total_retenues_salariales" DECIMAL(12,2) NOT NULL,
    "total_charges_patronales" DECIMAL(12,2) NOT NULL,
    "net_a_payer" DECIMAL(12,2) NOT NULL,
    "cout_employeur" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_closures_period_key_key" ON "payroll_closures"("period_key");

-- CreateIndex
CREATE INDEX "payroll_journal_lines_closure_id_idx" ON "payroll_journal_lines"("closure_id");

-- CreateIndex
CREATE INDEX "payroll_journal_lines_employee_id_idx" ON "payroll_journal_lines"("employee_id");

-- AddForeignKey
ALTER TABLE "payroll_journal_lines" ADD CONSTRAINT "payroll_journal_lines_closure_id_fkey" FOREIGN KEY ("closure_id") REFERENCES "payroll_closures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

