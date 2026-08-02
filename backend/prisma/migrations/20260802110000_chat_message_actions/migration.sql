-- Messagerie ERP — options « Modifier », « Transférer », « Répondre / citer »
-- (demande opérateur du 02/08/2026).
ALTER TABLE "chat_messages" ADD COLUMN "edited_at" TIMESTAMP(3);
ALTER TABLE "chat_messages" ADD COLUMN "forwarded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "chat_messages" ADD COLUMN "reply_to_id" TEXT;

ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_reply_to_id_fkey"
    FOREIGN KEY ("reply_to_id") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
