-- Les retenues du bulletin unitaire sont désormais reliées à la grille mensuelle
-- (source unique = payroll_monthly_lines). La table dédiée introduite plus tôt
-- dans la même session devient inutile : on la retire (aucune donnée de
-- production, période de test uniquement).
DROP TABLE IF EXISTS "payslip_monthly_deductions";
