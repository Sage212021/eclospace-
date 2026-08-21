-- Activation des rubriques de paie (Niveau 2, étape A) : une rubrique reste
-- « en attente » (in_force=false) tant que la direction ne l'a pas intégrée.
ALTER TABLE "salary_elements" ADD COLUMN "in_force" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "salary_elements" ADD COLUMN "effective_from" DATE;
