-- Machine à états de la paie mensuelle (chantier RH 12/08/2026) : nouvel état
-- intermédiaire « soumis_dg » (RH transmet la paie au DG, la grille se fige en
-- attente de validation) + traçabilité de la soumission RH et du retour DG.

-- AlterEnum : ajout de la valeur (append en fin d'enum ; l'ordre logique n'est
-- pas significatif — Prisma mappe par nom).
ALTER TYPE "PayrollMonthlyStatus" ADD VALUE IF NOT EXISTS 'soumis_dg';

-- AlterTable : traçabilité soumission / retour (colonnes nullables → aucune
-- donnée existante impactée).
ALTER TABLE "payroll_monthly_runs"
  ADD COLUMN "submitted_by" TEXT,
  ADD COLUMN "submitted_at" TIMESTAMP(3),
  ADD COLUMN "return_reason" TEXT,
  ADD COLUMN "returned_by" TEXT,
  ADD COLUMN "returned_at" TIMESTAMP(3);
