-- Encaissements éditoriaux (AuthorReceipt) reliés au bilan : entrée financière
-- (Payment « in ») créée à la comptabilisation (validation DAF).
ALTER TABLE "author_receipts" ADD COLUMN "payment_id" TEXT;
