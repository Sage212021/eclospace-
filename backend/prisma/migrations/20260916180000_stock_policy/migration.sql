-- Politique de stock par ouvrage (par ISBN) : seuils, stock cible, réimpression.
CREATE TABLE "stock_policies" (
    "id" TEXT NOT NULL,
    "isbn_id" TEXT NOT NULL,
    "alert_threshold" INTEGER,
    "reorder_threshold" INTEGER,
    "target_stock" INTEGER,
    "min_reprint_qty" INTEGER,
    "reprint_lead_days" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    CONSTRAINT "stock_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_policies_isbn_id_key" ON "stock_policies"("isbn_id");

ALTER TABLE "stock_policies" ADD CONSTRAINT "stock_policies_isbn_id_fkey" FOREIGN KEY ("isbn_id") REFERENCES "isbns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
