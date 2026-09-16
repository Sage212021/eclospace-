-- Date réelle de la dépense (distincte de la date de saisie created_at).
-- Le bilan de trésorerie répartit les dépenses par mois selon cette date.
ALTER TABLE "expenses" ADD COLUMN "expense_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Reprise des dépenses existantes : leur date réelle = leur date de saisie
-- (aucune autre information n'est disponible pour l'historique).
UPDATE "expenses" SET "expense_date" = "created_at";
