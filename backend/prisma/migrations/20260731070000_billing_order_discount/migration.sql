-- Remise commerciale prevue sur la commande a facturer (0 a 100 pourcent),
-- reprise a l'etablissement de la facture.
ALTER TABLE "billing_orders" ADD COLUMN IF NOT EXISTS "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0;
