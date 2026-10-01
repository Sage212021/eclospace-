-- Nouvelles catégories de pièces jointes : pièces d'identité de l'auteur
-- (CNI — carte nationale d'identité) et NIU (numéro d'identification unique).
ALTER TYPE "DocumentCategory" ADD VALUE IF NOT EXISTS 'cni';
ALTER TYPE "DocumentCategory" ADD VALUE IF NOT EXISTS 'niu';
