-- Surcharges ponctuelles du texte des articles standard d'un contrat (édition
-- avant impression, sur contrat non signé). Objet JSON { "<n° article>": "texte" }.
-- Additif : les contrats existants restent inchangés (colonne nullable).
ALTER TABLE "contracts" ADD COLUMN "article_overrides" JSONB;
