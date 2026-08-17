-- Annulation d'une vente au comptoir (suppression logique). La vente n'est
-- jamais effacée : elle passe « annulée » avec motif + auteur + horodatage.
ALTER TABLE "pos_sales" ADD COLUMN "cancelled_at" TIMESTAMP(3);
ALTER TABLE "pos_sales" ADD COLUMN "cancelled_by" TEXT;
ALTER TABLE "pos_sales" ADD COLUMN "cancellation_reason" TEXT;
