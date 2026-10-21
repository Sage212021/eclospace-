-- Espace de dialogue privé DG ↔ SAGE (« Échanger avec SAGE »).
CREATE TABLE "ai_conversations" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT 'Nouvelle conversation',
  "archived_at" TIMESTAMP(3),
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_conversations_owner_id_idx" ON "ai_conversations"("owner_id");

CREATE TABLE "ai_conversation_messages" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'done',
  "error_message" TEXT,
  "model" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" TEXT,
  CONSTRAINT "ai_conversation_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_conversation_messages_conversation_id_idx" ON "ai_conversation_messages"("conversation_id");
ALTER TABLE "ai_conversation_messages" ADD CONSTRAINT "ai_conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
