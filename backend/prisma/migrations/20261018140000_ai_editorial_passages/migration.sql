-- Mémoire de SAGE (Lot B) : le manuscrit est découpé en PASSAGES indexés par la
-- recherche plein texte PostgreSQL, pour répondre en citant le passage exact
-- (chapitre / extrait) sans redonner tout le texte. La colonne content_tsv est
-- une colonne GÉNÉRÉE (maintenue par Postgres) et n'est pas gérée par Prisma.
CREATE TABLE "ai_editorial_passages" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "chapter_label" TEXT,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('french', "content")) STORED,
    CONSTRAINT "ai_editorial_passages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_editorial_passages_manuscript_id_idx" ON "ai_editorial_passages"("manuscript_id");
CREATE INDEX "ai_editorial_passages_tsv_idx" ON "ai_editorial_passages" USING GIN ("content_tsv");

ALTER TABLE "ai_editorial_passages"
    ADD CONSTRAINT "ai_editorial_passages_manuscript_id_fkey"
    FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
