-- Banque des ISBN : statut ANNULÉ/INUTILISABLE (conservé, plus proposé à
-- l'attribution) + note libre « observations ».
ALTER TYPE "IsbnStatus" ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TABLE "isbns" ADD COLUMN "observations" TEXT;
