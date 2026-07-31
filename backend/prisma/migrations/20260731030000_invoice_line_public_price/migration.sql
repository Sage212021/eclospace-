-- Prix public HT unitaire avant remise, conservé sur la ligne de facture :
-- assiette des droits d'auteur pour les contrats « prix public HT » (Ch. 9
-- §9.5), afin qu'une remise commerciale ne réduise pas les droits de l'auteur.
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "unit_public_price" DECIMAL(10,2);
