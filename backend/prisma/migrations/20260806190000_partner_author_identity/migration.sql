-- Identité civile de l'auteur (reprise en tête du contrat d'édition),
-- collectée à l'enregistrement du manuscrit. Champs facultatifs, additifs.
ALTER TABLE "partners" ADD COLUMN "birth_date" TIMESTAMP(3);
ALTER TABLE "partners" ADD COLUMN "birth_place" TEXT;
ALTER TABLE "partners" ADD COLUMN "nationality" TEXT;
ALTER TABLE "partners" ADD COLUMN "profession" TEXT;
ALTER TABLE "partners" ADD COLUMN "id_number" TEXT;
ALTER TABLE "partners" ADD COLUMN "id_issued_date" TIMESTAMP(3);
ALTER TABLE "partners" ADD COLUMN "id_issued_place" TEXT;
