-- Contrôle qualité des exemplaires imprimés (Ch. 14 §14.7) : checklist de points
-- vérifiés + commentaire libre, tracés à chaque réception. Migration additive.
ALTER TABLE "goods_receipts" ADD COLUMN "qc_checklist" JSONB;
ALTER TABLE "goods_receipts" ADD COLUMN "qc_comment" TEXT;
