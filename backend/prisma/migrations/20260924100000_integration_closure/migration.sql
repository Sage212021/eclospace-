-- Clôture de l'intégration de correction par l'intégrateur (rangement perso vers
-- l'accordéon « Historique »), une par branche texte / couverture.
ALTER TABLE "manuscripts" ADD COLUMN "correction_integration_closed_at" TIMESTAMP(3);
ALTER TABLE "manuscripts" ADD COLUMN "cover_integration_closed_at" TIMESTAMP(3);
