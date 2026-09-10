-- « Quoi de neuf » : ciblage par ACCÈS (modules de permission), en plus du pôle
-- et du rôle. Une note atteint désormais les personnes qui ont réellement un
-- droit sur le module concerné — ce qui évite qu'un profil non concerné (ex. un
-- relecteur) reçoive une note RH ou contrats. On ré-arme aussi les notes
-- existantes (dispatched_at = NULL) : au prochain déploiement, le seed les
-- rediffusera à la bonne audience et retirera celles distribuées à tort.
ALTER TABLE "release_notes" ADD COLUMN "permission_modules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "release_notes" SET "dispatched_at" = NULL;
