-- Catégories d'absence ajoutées (permissions, suspensions, injustifiées).
ALTER TYPE "AbsenceType" ADD VALUE IF NOT EXISTS 'permission';
ALTER TYPE "AbsenceType" ADD VALUE IF NOT EXISTS 'suspension';
ALTER TYPE "AbsenceType" ADD VALUE IF NOT EXISTS 'injustifiee';

-- Catalogue des motifs d'absence (règles paramétrables).
CREATE TABLE "absence_reasons" (
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "category" "AbsenceType" NOT NULL,
  "paid" BOOLEAN NOT NULL DEFAULT true,
  "requires_justification" BOOLEAN NOT NULL DEFAULT false,
  "justification_deadline_days" INTEGER,
  "indicative_days_min" INTEGER,
  "indicative_days_max" INTEGER,
  "decrements_leave" BOOLEAN NOT NULL DEFAULT false,
  "payroll_deductible" BOOLEAN NOT NULL DEFAULT false,
  "is_fault" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" TEXT,
  CONSTRAINT "absence_reasons_pkey" PRIMARY KEY ("code")
);

-- Rattachement facultatif d'une absence à son motif.
ALTER TABLE "absences" ADD COLUMN "reason_code" TEXT;
ALTER TABLE "absences" ADD CONSTRAINT "absences_reason_code_fkey"
  FOREIGN KEY ("reason_code") REFERENCES "absence_reasons"("code") ON DELETE SET NULL ON UPDATE CASCADE;
