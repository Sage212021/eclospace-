-- Nouvelle catégorie de document : « pièce d'étape » — fichier/scan déposé
-- librement à une étape de production par l'acteur de l'étape (fiche technique,
-- justificatif, scan…).
ALTER TYPE "DocumentCategory" ADD VALUE IF NOT EXISTS 'piece_etape';
