-- Désignations détaillées (lignes + montants) sur le devis d'impression et
-- report sur le bon de commande.
ALTER TABLE "print_quotes" ADD COLUMN "designations" JSONB;
ALTER TABLE "purchase_orders" ADD COLUMN "line_items" JSONB;
