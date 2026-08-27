-- Audit éditorial, point n°3 : déclaration de conflit d'intérêt du lecteur.
-- Colonnes additives ; aucune donnée existante touchée.
ALTER TABLE "reading_assignments" ADD COLUMN "conflict_declared_at" TIMESTAMP(3);
ALTER TABLE "reading_assignments" ADD COLUMN "conflict_has_conflict" BOOLEAN;
ALTER TABLE "reading_assignments" ADD COLUMN "conflict_details" TEXT;
