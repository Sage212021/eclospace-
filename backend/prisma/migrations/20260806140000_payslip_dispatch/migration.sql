-- Suivi des envois de bulletins de paie par e-mail (statut + relance).
CREATE TYPE "PayslipDispatchStatus" AS ENUM ('pending', 'sent', 'failed');
CREATE TABLE "payslip_dispatches" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "status" "PayslipDispatchStatus" NOT NULL DEFAULT 'pending',
  "error" TEXT,
  "has_pdf" BOOLEAN NOT NULL DEFAULT false,
  "sent_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payslip_dispatches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payslip_dispatches_employee_id_period_idx" ON "payslip_dispatches"("employee_id", "period");
