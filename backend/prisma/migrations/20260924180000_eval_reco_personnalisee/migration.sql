-- Recommandation d'évaluation PERSONNALISÉE (texte libre), exclusive des
-- recommandations prédéfinies (choix « prédéfinie OU personnalisée »).
ALTER TYPE "EvaluationRecommendation" ADD VALUE IF NOT EXISTS 'personnalisee';
