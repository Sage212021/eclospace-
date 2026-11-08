-- Mentions légales d'un fournisseur/prestataire (imprimeur) à reporter sur les
-- documents d'achat : registre de commerce (RCCM) et compte bancaire sur la
-- fiche Partenaire ; instantané NIU / RCCM / compte sur le bon de commande.
ALTER TABLE "partners" ADD COLUMN "rccm" TEXT;
ALTER TABLE "partners" ADD COLUMN "bank_account" TEXT;

ALTER TABLE "purchase_order_vouchers" ADD COLUMN "supplier_tax_id" TEXT;
ALTER TABLE "purchase_order_vouchers" ADD COLUMN "supplier_registration" TEXT;
ALTER TABLE "purchase_order_vouchers" ADD COLUMN "supplier_bank_account" TEXT;
