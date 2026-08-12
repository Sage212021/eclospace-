-- Lignes libres du bulletin (gains/retenues ajoutés par le RH, non codés en dur) :
-- tableau JSON par ligne mensuelle de salarié. Nullable → additif, sans impact.
ALTER TABLE "payroll_monthly_lines" ADD COLUMN "extra_lines" JSONB;
