-- Mémoire institutionnelle & éditoriale validée de SAGE (base de connaissances maison).
CREATE TABLE "ai_knowledge" (
  "id" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'institution',
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'validated',
  "created_by" TEXT,
  "validated_by" TEXT,
  "validated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" TEXT,
  CONSTRAINT "ai_knowledge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_knowledge_status_idx" ON "ai_knowledge"("status");
