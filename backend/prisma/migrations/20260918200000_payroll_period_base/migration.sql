-- Salaire rattaché à la PÉRIODE : chaque ligne de paie mensuelle fige son propre
-- salaire de base et brut contractuel (indépendance des périodes). Nullable :
-- null = ligne antérieure → repli sur la fiche du salarié.
ALTER TABLE "payroll_monthly_lines" ADD COLUMN "base_salary" DECIMAL(12,2);
ALTER TABLE "payroll_monthly_lines" ADD COLUMN "gross_contractual" DECIMAL(12,2);

-- Reprise (mois OUVERTS uniquement — non clôturés) : chaque ligne d'un mois non
-- clôturé reprend le salaire ACTUEL de la fiche comme base de sa période. Les
-- mois clôturés (présents dans payroll_closures) restent tels quels (figés).
UPDATE "payroll_monthly_lines" AS l
SET
  "gross_contractual" = p."gross_contractual",
  "base_salary" = COALESCE(c."base_salary", ROUND(p."gross_contractual" * p."base_pct"))
FROM "payroll_monthly_runs" AS r,
     "payroll_employee_profiles" AS p
     LEFT JOIN "employee_confidential" AS c ON c."employee_id" = p."employee_id"
WHERE l."run_id" = r."id"
  AND p."employee_id" = l."employee_id"
  AND NOT EXISTS (SELECT 1 FROM "payroll_closures" pc WHERE pc."period_key" = r."period_key");
