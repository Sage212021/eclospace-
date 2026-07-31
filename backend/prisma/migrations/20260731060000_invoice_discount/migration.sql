-- Remise commerciale globale sur la facture (0 a 100 pourcent) : total_ttc devient
-- le net a payer apres remise ; total_ht/total_tax restent le brut (somme des lignes).
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0;
