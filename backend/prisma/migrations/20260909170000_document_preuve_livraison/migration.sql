-- Nouvelle catégorie de document : « preuve de livraison » — scan/photo du bon
-- de livraison signé à la réception, rattaché à une livraison (Ch. 17 §17.8).
ALTER TYPE "DocumentCategory" ADD VALUE IF NOT EXISTS 'preuve_livraison';
