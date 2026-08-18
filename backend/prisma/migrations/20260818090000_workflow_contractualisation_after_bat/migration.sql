-- Décision opérateur D-010 (18/08/2026) : la « Contractualisation » est déplacée
-- juste APRÈS la « Validation du BAT » (elle était à l'étape 5, avant la
-- production). Nouvel enchaînement : Validation BAT → Contractualisation →
-- Impression. Dérogation assumée au Ch. 9 §9.12.
--
-- Seul le bloc des étapes 5 à 13 est renuméroté ; Impression (14) et la suite ne
-- bougent pas. On ne touche NI aux codes, NI aux id des étapes, NI aux
-- manuscrits/étapes déjà enregistrés : l'historique réel (dates, transitions)
-- est préservé, seul l'ordre de référence change.
UPDATE "workflow_statuses" SET "step_order" = 5  WHERE "code" = 'PLANIFICATION';
UPDATE "workflow_statuses" SET "step_order" = 6  WHERE "code" = 'CORRECTION';
UPDATE "workflow_statuses" SET "step_order" = 7  WHERE "code" = 'EXPERTISE';
UPDATE "workflow_statuses" SET "step_order" = 8  WHERE "code" = 'REECRITURE';
UPDATE "workflow_statuses" SET "step_order" = 9  WHERE "code" = 'MISE_EN_PAGE';
UPDATE "workflow_statuses" SET "step_order" = 10 WHERE "code" = 'INFOGRAPHIE';
UPDATE "workflow_statuses" SET "step_order" = 11 WHERE "code" = 'ATTRIBUTION_REFERENCES';
UPDATE "workflow_statuses" SET "step_order" = 12 WHERE "code" = 'VALIDATION_BAT';
UPDATE "workflow_statuses" SET "step_order" = 13 WHERE "code" = 'CONTRACTUALISATION';
