-- Date de naissance (facultative) sur la fiche employé, pour les anniversaires
-- automatiques du calendrier partagé. Additif, aucune donnée existante modifiée.
ALTER TABLE "employees" ADD COLUMN "birth_date" TIMESTAMP(3);
