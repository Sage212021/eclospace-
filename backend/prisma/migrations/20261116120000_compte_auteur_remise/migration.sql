-- D-064 : compte d'auteur — pas d'entrée en stock (exemplaires remis à l'auteur),
-- passage compte d'auteur → compte d'éditeur via avenant.

-- 1) Modèle économique EFFECTIF de l'ouvrage (déduit du contrat actif ou choisi
--    à la réception pour un ouvrage rattrapé).
ALTER TABLE "manuscripts" ADD COLUMN "economic_model" "EconomicModel";

-- 2) Remise des exemplaires à l'auteur (alternative à l'entrée en stock).
ALTER TABLE "goods_receipts" ADD COLUMN "author_handover_at" TIMESTAMP(3);

-- 3) Commercialisation / Vente / Suivi deviennent CONDITIONNELLES (sautées pour un
--    compte d'auteur). Requises par défaut pour les autres modèles.
UPDATE "workflow_statuses" SET "is_conditional" = true
  WHERE "code" IN ('COMMERCIALISATION', 'VENTE_LIVRAISON', 'SUIVI_POST_PUBLICATION');
