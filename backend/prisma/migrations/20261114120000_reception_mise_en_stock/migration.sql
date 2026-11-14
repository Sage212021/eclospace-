-- D-056 : la fin de production est regroupée en UNE seule étape
-- « Réception et mise en stock », pilotée par le pôle Stock & magasin.

-- 1) Contrôle qualité quantitatif (quantité conforme) + horodatage d'entrée en
--    stock, sur chaque réception. Additif : aucune donnée existante modifiée.
ALTER TABLE "goods_receipts" ADD COLUMN "quantity_conform" INTEGER;
ALTER TABLE "goods_receipts" ADD COLUMN "stock_entered_at" TIMESTAMP(3);

-- 2) L'étape « Contrôle qualité (exemplaires imprimés) » devient l'étape UNIQUE
--    « Réception et mise en stock », rattachée au pôle Stock & magasin. On GARDE
--    son code (CONTROLE_QUALITE_IMPRESSION) pour préserver toutes les références
--    et l'historique ; seuls le libellé et le pôle responsable changent.
UPDATE "workflow_statuses"
  SET "label" = 'Réception et mise en stock',
      "department_id" = (SELECT "id" FROM "departments" WHERE "code" = 'STOCK')
  WHERE "code" = 'CONTROLE_QUALITE_IMPRESSION';

-- 3) L'ancienne étape « Entrée en stock » est RETIRÉE du circuit actif : elle est
--    absorbée par l'étape ci-dessus. Marquée conditionnelle, elle est désormais
--    SAUTÉE par la navigation (findNextApplicableStatus/Previous). La ligne est
--    CONSERVÉE (jamais supprimée) pour ne pas casser l'historique des ouvrages
--    déjà passés en stock (manuscript_steps.status_id, manuscripts.status_id) ;
--    un ouvrage qui se trouverait encore à cette étape la valide normalement.
UPDATE "workflow_statuses" SET "is_conditional" = true WHERE "code" = 'ENTREE_STOCK';
