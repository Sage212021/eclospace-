-- Date d'émission officielle (validation définitive) imprimée sur la facture.
-- Nullable : les factures existantes retombent sur created_at à l'impression.
ALTER TABLE "invoices" ADD COLUMN "issued_at" TIMESTAMP(3);

-- Reprise : pour les factures déjà émises (non en attente de validation), la
-- date d'émission connue la plus fiable est leur date de création.
UPDATE "invoices" SET "issued_at" = "created_at" WHERE "status" <> 'pending_validation';
