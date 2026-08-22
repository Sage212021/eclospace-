-- Caractéristiques d'écriture / composition (Ch. 11 §11.4) sur la fiche technique
-- de fabrication (étape 9). Colonnes additives et nullables : aucun impact sur
-- l'existant, aucune donnée touchée.
ALTER TABLE "production_specs" ADD COLUMN "typeface" TEXT;
ALTER TABLE "production_specs" ADD COLUMN "font_size_pt" TEXT;
ALTER TABLE "production_specs" ADD COLUMN "leading" TEXT;
ALTER TABLE "production_specs" ADD COLUMN "margins" TEXT;
ALTER TABLE "production_specs" ADD COLUMN "layout_name" TEXT;
