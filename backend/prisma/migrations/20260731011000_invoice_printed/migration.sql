-- Une facture « tirée » (imprimée) ne peut plus être annulée (décision opérateur
-- du 31/07/2026). On date la première impression du document officiel.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "printed_at" TIMESTAMP(3);
