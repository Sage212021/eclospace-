-- Fiche d'enregistrement enrichie : identité auteur complète + frais de dépôt évaluation + délai de réponse.
ALTER TABLE "partners" ADD COLUMN "id_type" TEXT;
ALTER TABLE "partners" ADD COLUMN "country" TEXT;
ALTER TABLE "partners" ADD COLUMN "city" TEXT;
ALTER TABLE "partners" ADD COLUMN "quartier" TEXT;
ALTER TABLE "partners" ADD COLUMN "postal_box" TEXT;
ALTER TABLE "partners" ADD COLUMN "other_contact" TEXT;
ALTER TABLE "partners" ADD COLUMN "niu" TEXT;

CREATE TYPE "EvaluationFeeChoice" AS ENUM ('non_defini', 'a_payer', 'sans_frais');
ALTER TABLE "manuscripts" ADD COLUMN "evaluation_fee_choice" "EvaluationFeeChoice" NOT NULL DEFAULT 'non_defini';
ALTER TABLE "manuscripts" ADD COLUMN "author_response_delay_days" INTEGER;
