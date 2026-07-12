-- Module « Présences » — incrément 3 : règles de retenues paramétrables et
-- versionnées. Additif uniquement (une table + un enum), aucune donnée
-- existante impactée. Réversible.

-- CreateEnum
CREATE TYPE "DeductionMethod" AS ENUM ('prorata', 'round_half_hour', 'round_hour', 'custom');

-- CreateTable
CREATE TABLE "deduction_rules" (
    "id" TEXT NOT NULL,
    "per_minute" DECIMAL(12,2),
    "per_half_hour" DECIMAL(12,2) NOT NULL DEFAULT 500,
    "per_hour" DECIMAL(12,2) NOT NULL DEFAULT 1000,
    "daily_cap" DECIMAL(12,2),
    "monthly_cap" DECIMAL(12,2),
    "method" "DeductionMethod" NOT NULL DEFAULT 'prorata',
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "deduction_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deduction_rules_active_effective_from_idx" ON "deduction_rules"("active", "effective_from");
