-- Bon de commande : consignes libres à l'imprimeur (la fiche technique reste
-- lue depuis production_specs, non dupliquée).
ALTER TABLE "purchase_orders" ADD COLUMN "printer_instructions" TEXT;
