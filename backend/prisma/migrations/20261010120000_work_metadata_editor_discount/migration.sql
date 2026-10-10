-- Prix éditeur paramétrable : taux de remise éditeur propre (comme la remise pro).
ALTER TABLE "work_metadata" ADD COLUMN "editor_discount_pct" DECIMAL(5,2);
