-- Motif de modification d'une version du barème (Lot 4, ch. 10) : traçabilité du
-- « pourquoi » de chaque nouvelle version. Nullable → additif, sans impact.
ALTER TABLE "payroll_rate_sets" ADD COLUMN "change_reason" TEXT;
