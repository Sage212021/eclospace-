-- Éditeur de formules de paie (D-007) : le RH peut modifier la formule de calcul
-- de certains éléments du bulletin, avec motif. Table additive uniquement.
CREATE TABLE "payroll_formulas" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "expression" TEXT NOT NULL,
    "custom" BOOLEAN NOT NULL DEFAULT false,
    "change_reason" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payroll_formulas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payroll_formulas_code_key" ON "payroll_formulas"("code");
