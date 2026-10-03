-- BAT à DOUBLE validation : pré-validation (1re signature, l'infographe/opérateur)
-- puis contre-validation (2e signature, la Direction générale). Tant que
-- validated_at est nul, l'ouvrage reste à l'étape ; la contre-validation ne peut
-- être faite par le pré-validateur.
ALTER TABLE "manuscript_steps" ADD COLUMN "pre_validated_at" TIMESTAMP(3);
ALTER TABLE "manuscript_steps" ADD COLUMN "pre_validated_by" TEXT;
