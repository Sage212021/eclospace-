-- Suppression logique d'un devis d'impression (doublon / erreur) tant qu'il
-- n'a pas donné lieu à un bon de commande.
ALTER TABLE "print_quotes" ADD COLUMN "deleted_at" TIMESTAMP(3);
