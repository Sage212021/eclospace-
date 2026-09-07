-- « Quoi de neuf » : notes de version distribuées aux pôles concernés à chaque
-- déploiement (une notification par utilisateur, idempotent via slug).
CREATE TABLE "release_notes" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "audience_all" BOOLEAN NOT NULL DEFAULT false,
  "department_codes" TEXT[],
  "role_codes" TEXT[],
  "dispatched_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "release_notes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "release_notes_slug_key" ON "release_notes"("slug");
