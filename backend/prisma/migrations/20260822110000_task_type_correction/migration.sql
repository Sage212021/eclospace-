-- Type de tâche « Correction éditoriale » générique (auto-créée à l'affectation
-- de l'étape de correction). Valeur d'enum additive, aucune donnée touchée.
ALTER TYPE "TaskType" ADD VALUE IF NOT EXISTS 'correction';
