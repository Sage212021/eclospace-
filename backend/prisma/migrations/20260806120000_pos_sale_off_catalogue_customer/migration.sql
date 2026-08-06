-- Vente au comptoir : livre « hors catalogue » (provisoire) + client optionnel.
-- isbn_id devient nullable (ligne hors catalogue) ; infos livre en texte libre ;
-- customer_id optionnel (au choix du commercial).
ALTER TABLE "pos_sales" ALTER COLUMN "isbn_id" DROP NOT NULL;
ALTER TABLE "pos_sales" ADD COLUMN "off_catalogue_title" TEXT;
ALTER TABLE "pos_sales" ADD COLUMN "off_catalogue_author" TEXT;
ALTER TABLE "pos_sales" ADD COLUMN "off_catalogue_isbn" TEXT;
ALTER TABLE "pos_sales" ADD COLUMN "customer_id" TEXT;
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
