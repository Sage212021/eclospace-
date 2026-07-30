-- Échéance d'affichage des notifications : au-delà, elles disparaissent de la
-- cloche. Null = pas de délai propre (règle des 24 h appliquée à la lecture).
ALTER TABLE "notifications" ADD COLUMN "expires_at" TIMESTAMP(3);
