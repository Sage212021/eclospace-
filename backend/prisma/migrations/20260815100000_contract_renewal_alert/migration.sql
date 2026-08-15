-- Alertes d'échéance de contrats : horodatage anti-doublon de la dernière alerte
-- envoyée à la Direction pour un contrat arrivant à terme. Champ additif.
ALTER TABLE "contracts" ADD COLUMN "renewal_alert_sent_at" TIMESTAMP(3);
