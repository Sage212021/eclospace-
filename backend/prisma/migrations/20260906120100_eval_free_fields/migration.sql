-- Champs libres de la remise d'évaluation :
--  • recommendation_note : recommandation en texte libre (précisions du relecteur) ;
--  • reviewer_name : nom du relecteur (défaut applicatif « Comité de lecture d'Éclosion Édition »).
ALTER TABLE "evaluations" ADD COLUMN "recommendation_note" TEXT;
ALTER TABLE "evaluations" ADD COLUMN "reviewer_name" TEXT;
