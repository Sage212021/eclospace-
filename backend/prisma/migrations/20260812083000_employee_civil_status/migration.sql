-- État civil de l'employé (feuille « Employés » du moteur) : situation familiale
-- et nombre d'enfants, affichés sur le bulletin de paie. Colonnes nullables →
-- aucune donnée existante impactée.
ALTER TABLE "employees"
  ADD COLUMN "marital_status" TEXT,
  ADD COLUMN "children_count" INTEGER;
