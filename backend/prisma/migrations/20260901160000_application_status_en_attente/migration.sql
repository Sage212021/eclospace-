-- Nouveau statut de candidature « en attente » (vivier RH) : ni retenu ni
-- refusé. Statut non terminal. Ajout idempotent de la valeur d'énumération.
ALTER TYPE "JobApplicationStatus" ADD VALUE IF NOT EXISTS 'en_attente';
