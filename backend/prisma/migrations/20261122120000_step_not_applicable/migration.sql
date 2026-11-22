-- « Non applicable » (D-075) : une étape peut être déclarée non applicable à un
-- ouvrage (numérique, déjà paru…) ; la navigation la saute sans bloquer la suite.
ALTER TABLE "manuscript_steps" ADD COLUMN "not_applicable_at" TIMESTAMP(3);
ALTER TABLE "manuscript_steps" ADD COLUMN "not_applicable_by" TEXT;
ALTER TABLE "manuscript_steps" ADD COLUMN "not_applicable_reason" TEXT;
