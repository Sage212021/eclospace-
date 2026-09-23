-- Isolation stricte de la paie par période (D-070) : on FIGE toute l'assiette
-- fiscale/ancienneté sur la ligne du mois, en plus du salaire de base/brut déjà
-- figés. Ainsi chaque période est une photographie autonome : modifier la fiche
-- du salarié (ou un autre mois) ne recalcule plus un mois déjà préparé.
ALTER TABLE "payroll_monthly_lines" ADD COLUMN "fiscal_base" DECIMAL(12,2);
ALTER TABLE "payroll_monthly_lines" ADD COLUMN "fiscal_parts" DECIMAL(4,1);
ALTER TABLE "payroll_monthly_lines" ADD COLUMN "apply_fiscal_parts" BOOLEAN;
ALTER TABLE "payroll_monthly_lines" ADD COLUMN "seniority_years" INTEGER;
ALTER TABLE "payroll_monthly_lines" ADD COLUMN "seniority_rate" DECIMAL(6,4);
ALTER TABLE "payroll_monthly_lines" ADD COLUMN "seniority_threshold" INTEGER;
ALTER TABLE "payroll_monthly_lines" ADD COLUMN "apply_seniority" BOOLEAN;

-- BACKFILL : on gèle toutes les lignes EXISTANTES sur la valeur qu'elles
-- affichent actuellement (réplique de resolveBaseGross : base = base confidentielle
-- si présente, sinon brut contractuel × % de base ; brut = max(brut contractuel, base)).
-- COALESCE : on ne touche pas une valeur déjà figée sur la ligne. Résultat : plus
-- aucune ligne ne dérive avec la fiche du salarié ; les mois déjà figés (base non
-- nulle) retrouvent leur valeur d'origine dès que le moteur lit la ligne.
UPDATE "payroll_monthly_lines" l
SET
  "base_salary" = COALESCE(l."base_salary",
    CASE WHEN ec."base_salary" IS NOT NULL THEN ec."base_salary"
         ELSE ROUND(prof."gross_contractual" * prof."base_pct") END),
  "gross_contractual" = COALESCE(l."gross_contractual",
    GREATEST(prof."gross_contractual",
      CASE WHEN ec."base_salary" IS NOT NULL THEN ec."base_salary"
           ELSE ROUND(prof."gross_contractual" * prof."base_pct") END)),
  "fiscal_base" = COALESCE(l."fiscal_base", prof."fiscal_base"),
  "fiscal_parts" = COALESCE(l."fiscal_parts", prof."fiscal_parts"),
  "apply_fiscal_parts" = COALESCE(l."apply_fiscal_parts", prof."apply_fiscal_parts"),
  "seniority_years" = COALESCE(l."seniority_years", prof."seniority_years"),
  "seniority_rate" = COALESCE(l."seniority_rate", prof."seniority_rate"),
  "seniority_threshold" = COALESCE(l."seniority_threshold", prof."seniority_threshold"),
  "apply_seniority" = COALESCE(l."apply_seniority", prof."apply_seniority")
FROM "payroll_employee_profiles" prof
LEFT JOIN "employee_confidential" ec ON ec."employee_id" = prof."employee_id"
WHERE prof."employee_id" = l."employee_id";
