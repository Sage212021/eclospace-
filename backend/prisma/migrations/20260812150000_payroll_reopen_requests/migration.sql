-- Réouverture exceptionnelle d'une paie validée/verrouillée (ch. 23) : demande
-- RH → autorisation DG. Table + enum nouveaux uniquement (additif).
CREATE TYPE "PayrollReopenStatus" AS ENUM ('en_attente', 'autorisee', 'refusee');

CREATE TABLE "payroll_reopen_requests" (
    "id" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "employee_id" TEXT,
    "element" TEXT NOT NULL,
    "old_value" TEXT,
    "requested_correction" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "PayrollReopenStatus" NOT NULL DEFAULT 'en_attente',
    "requested_by" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_reason" TEXT,
    CONSTRAINT "payroll_reopen_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payroll_reopen_requests_period_key_idx" ON "payroll_reopen_requests"("period_key");
