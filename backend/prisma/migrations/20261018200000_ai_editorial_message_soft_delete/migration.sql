-- Suppression LOGIQUE d'un message du tchat SAGE (règle d'intégrité §13 : jamais
-- de suppression physique). Un message supprimé est masqué de l'historique et
-- du contexte envoyé au modèle.
ALTER TABLE "ai_editorial_messages" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "ai_editorial_messages" ADD COLUMN "deleted_by" TEXT;
