-- Module « Primes du mois » (demande opérateur 09/09/2026) : primes
-- individuelles par salarié et par mois, avec type/motif/date/observation et un
-- cycle à valider → validée → annulée. Le total des primes validées alimente
-- automatiquement la ligne de paie du mois.
CREATE TYPE "PrimeType" AS ENUM ('rendement', 'transport', 'exceptionnelle', 'responsabilite', 'autre');
CREATE TYPE "PrimeStatus" AS ENUM ('a_valider', 'validee', 'annulee');

CREATE TABLE "primes" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "type" "PrimeType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "motif" TEXT,
    "date_awarded" TIMESTAMP(3) NOT NULL,
    "observation" TEXT,
    "status" "PrimeStatus" NOT NULL DEFAULT 'a_valider',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "validated_by" TEXT,
    "validated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "primes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "primes_period_key_idx" ON "primes"("period_key");
CREATE INDEX "primes_employee_id_idx" ON "primes"("employee_id");

ALTER TABLE "primes" ADD CONSTRAINT "primes_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
