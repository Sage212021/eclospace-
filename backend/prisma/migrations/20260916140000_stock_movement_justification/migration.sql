-- Bénéficiaire / origine d'un mouvement de stock (texte libre, §3).
ALTER TABLE "stock_movements" ADD COLUMN "beneficiary" TEXT;

-- Catégorie GED pour les justificatifs de mouvement (photo, PV, constat — §6).
ALTER TYPE "DocumentCategory" ADD VALUE 'justificatif_stock';
