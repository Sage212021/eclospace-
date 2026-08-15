-- Lot 4 compte auteur (§14) : exemplaires dus (au contrat) vs effectivement
-- remis à l'auteur, par catégorie. Additif uniquement.

CREATE TYPE "AuthorCopyCategory" AS ENUM ('contractuel', 'gratuit', 'promotionnel', 'evenement', 'achete', 'autre');

ALTER TABLE "royalty_terms" ADD COLUMN "author_free_copies" INTEGER;

CREATE TABLE "author_copy_entries" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "isbn_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "category" "AuthorCopyCategory" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "stock_movement_id" TEXT,
    "delivered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "author_copy_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "author_copy_entries_partner_id_idx" ON "author_copy_entries"("partner_id");
CREATE INDEX "author_copy_entries_isbn_id_idx" ON "author_copy_entries"("isbn_id");

ALTER TABLE "author_copy_entries" ADD CONSTRAINT "author_copy_entries_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "author_copy_entries" ADD CONSTRAINT "author_copy_entries_isbn_id_fkey" FOREIGN KEY ("isbn_id") REFERENCES "isbns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "author_copy_entries" ADD CONSTRAINT "author_copy_entries_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
