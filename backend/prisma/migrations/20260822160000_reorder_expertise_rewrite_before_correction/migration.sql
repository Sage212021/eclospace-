-- Réordonnancement (D-014) : Expertise et Réécriture AVANT la Correction
-- éditoriale. Planification → Expertise (6) → Réécriture (7) → Correction (8).
-- Le workflow calcule l'étape suivante par step_order ; step_order n'est pas
-- unique, on met simplement à jour les 3 lignes concernées.
UPDATE "workflow_statuses" SET "step_order" = 6 WHERE "code" = 'EXPERTISE';
UPDATE "workflow_statuses" SET "step_order" = 7 WHERE "code" = 'REECRITURE';
UPDATE "workflow_statuses" SET "step_order" = 8 WHERE "code" = 'CORRECTION';
