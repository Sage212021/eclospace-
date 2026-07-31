-- Annulation d'une facture soumise à validation du DG (décision opérateur du
-- 31/07/2026) : le comptable DEMANDE l'annulation (motif), le DG la VALIDE ;
-- ce n'est qu'une fois validée que la facture passe « annulée » et sort du
-- chiffre d'affaires. Nouveau statut intermédiaire + traçabilité de la demande.

-- AlterEnum (isolé : un ajout de valeur d'enum ne s'utilise pas dans la même
-- transaction — on ne fait ici qu'ajouter la valeur, sans l'employer).
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'cancellation_requested';

-- AlterTable : trace de la demande d'annulation (motif, auteur, date).
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "cancellation_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "cancellation_requested_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancellation_requested_by" TEXT;
