-- Suivi de prise en charge de la paie par le DAF après validation DG (Temps 2) :
-- check-list datée (décaissement, déclarations CNPS/impôts, archivage) + clôture
-- du suivi. Table additive, distincte du livre de paie clôturé.
CREATE TABLE "payroll_handoffs" (
  "id" TEXT NOT NULL,
  "period_key" TEXT NOT NULL,
  "salaries_paid_at" TIMESTAMP(3),
  "salaries_paid_by" TEXT,
  "cnps_declared_at" TIMESTAMP(3),
  "cnps_declared_by" TEXT,
  "cnps_ref" TEXT,
  "tax_declared_at" TIMESTAMP(3),
  "tax_declared_by" TEXT,
  "tax_ref" TEXT,
  "archived_at" TIMESTAMP(3),
  "archived_by" TEXT,
  "closed_at" TIMESTAMP(3),
  "closed_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_handoffs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payroll_handoffs_period_key_key" ON "payroll_handoffs"("period_key");
