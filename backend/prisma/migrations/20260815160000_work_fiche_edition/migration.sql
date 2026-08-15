-- Lot 2 fiche ouvrage : type d'édition, prix (public / pro / éditeur), coût
-- unitaire, statut de commercialisation et champs scolaires (§3, §4). Additif.

CREATE TYPE "EditionType" AS ENUM ('compte_editeur', 'compte_auteur', 'coedition', 'coproduction', 'partenariat', 'autre');
CREATE TYPE "CommercializationStatus" AS ENUM ('a_paraitre', 'disponible', 'epuise', 'arret_commercialisation');

ALTER TABLE "work_metadata"
  ADD COLUMN "edition_type" "EditionType",
  ADD COLUMN "price_public" DECIMAL(12,2),
  ADD COLUMN "price_pro" DECIMAL(12,2),
  ADD COLUMN "price_editeur" DECIMAL(12,2),
  ADD COLUMN "unit_production_cost" DECIMAL(12,2),
  ADD COLUMN "commercialization_status" "CommercializationStatus",
  ADD COLUMN "is_school_book" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "school_level" TEXT,
  ADD COLUMN "school_subject" TEXT,
  ADD COLUMN "school_year" TEXT;
