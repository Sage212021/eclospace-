-- Veille des abonnements : lecture automatique de la consommation.
-- Source de lecture auto (ex. "anthropic_cost"), date de dernière synchro
-- réussie, et dernière erreur de synchro. Aucune clé secrète stockée ici.
ALTER TABLE "digital_services" ADD COLUMN "usage_auto_source" TEXT;
ALTER TABLE "digital_services" ADD COLUMN "usage_synced_at" TIMESTAMP(3);
ALTER TABLE "digital_services" ADD COLUMN "usage_sync_error" TEXT;
