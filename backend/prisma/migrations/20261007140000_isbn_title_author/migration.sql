-- Banque des ISBN : titre/auteur portés directement par l'ISBN pour les anciens
-- numéros importés sans manuscrit Eclospace lié.
ALTER TABLE "isbns" ADD COLUMN "title" TEXT;
ALTER TABLE "isbns" ADD COLUMN "author_name" TEXT;
