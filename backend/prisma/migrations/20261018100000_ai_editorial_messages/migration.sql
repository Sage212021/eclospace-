-- Éditeur littéraire IA (« ÉCLOSION ÉDITORIAL IA ») — dialogue éditorial
-- persistant sur un ouvrage enregistré. Historique complet des échanges et des
-- diagnostics (en plus du journal d'audit). Réservé DG + admin (contrôlé côté
-- serveur). L'intégrité référentielle est garantie par la clé étrangère.
CREATE TABLE "ai_editorial_messages" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'chat',
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'done',
    "error_message" TEXT,
    "model" TEXT,
    "cost_estimate" DECIMAL(12,2),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_editorial_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_editorial_messages_manuscript_id_idx" ON "ai_editorial_messages"("manuscript_id");

ALTER TABLE "ai_editorial_messages"
    ADD CONSTRAINT "ai_editorial_messages_manuscript_id_fkey"
    FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
