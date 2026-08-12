-- Bulletin (bloc « Informations complémentaires & congés ») : téléphone du
-- salarié et cumul des jours de congés pris. Colonnes nullables → aucune donnée
-- existante impactée.
ALTER TABLE "employees"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "leave_taken_days" DECIMAL(5,1);
