-- Articles additionnels propres à un contrat (clauses ajoutées au modèle).
ALTER TABLE "contracts" ADD COLUMN "custom_clauses" JSONB;
