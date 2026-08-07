-- Circuit devis → Éditorial → client → facture : passage du devis par l'Éditorial.
ALTER TABLE "editorial_quotes" ADD COLUMN "editorial_handoff_at" TIMESTAMP(3);
ALTER TABLE "editorial_quotes" ADD COLUMN "editorial_handoff_by" TEXT;
