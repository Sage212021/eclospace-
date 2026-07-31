-- Détail par ouvrage des commandes à facturer « livre scolaire » (ISBN, quantité,
-- prix unitaire HT, taux de droits éventuel) : support du calcul des droits
-- d'auteur livre par livre.
CREATE TABLE "billing_order_lines" (
    "id" TEXT NOT NULL,
    "billing_order_id" TEXT NOT NULL,
    "isbn_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_ht" DECIMAL(10,2) NOT NULL,
    "royalty_rate" DECIMAL(5,4),
    CONSTRAINT "billing_order_lines_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "billing_order_lines" ADD CONSTRAINT "billing_order_lines_billing_order_id_fkey"
    FOREIGN KEY ("billing_order_id") REFERENCES "billing_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_order_lines" ADD CONSTRAINT "billing_order_lines_isbn_id_fkey"
    FOREIGN KEY ("isbn_id") REFERENCES "isbns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Relevé des droits d'auteur du livre scolaire, segmenté et immuable (conformité) :
-- ouvrage, auteur, co-auteurs, ISBN, prix unitaire, quantité, assiette, taux, montant.
CREATE TABLE "school_royalty_entries" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "invoice_line_id" TEXT,
    "manuscript_id" TEXT,
    "isbn_id" TEXT,
    "book_title" TEXT NOT NULL,
    "isbn_code" TEXT,
    "author_name" TEXT,
    "co_authors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unit_price_ht" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "base_amount" DECIMAL(12,2) NOT NULL,
    "rate_applied" DECIMAL(5,4) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "source_type" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "school_royalty_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "school_royalty_entries_manuscript_id_idx" ON "school_royalty_entries"("manuscript_id");
CREATE INDEX "school_royalty_entries_invoice_id_idx" ON "school_royalty_entries"("invoice_id");

ALTER TABLE "school_royalty_entries" ADD CONSTRAINT "school_royalty_entries_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "school_royalty_entries" ADD CONSTRAINT "school_royalty_entries_manuscript_id_fkey"
    FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "school_royalty_entries" ADD CONSTRAINT "school_royalty_entries_isbn_id_fkey"
    FOREIGN KEY ("isbn_id") REFERENCES "isbns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
