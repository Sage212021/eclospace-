-- Auteur d'affichage de la fiche catalogue (nom de plume imprimé sur la
-- couverture). N'efface pas l'auteur réel (contributeur). Demande opérateur.
ALTER TABLE "manuscripts" ADD COLUMN "legend_author" TEXT;
