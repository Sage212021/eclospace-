-- D-078 : repositionnement de la fin de parcours.
-- 1) Nouvelle étape « Clôture de production » JUSTE APRÈS l'Impression (fin de
--    fabrication, archivage du dossier de production).
-- 2) L'ancienne étape terminale (code ARCHIVAGE, mal nommée « Clôture de production »
--    en D-076) redevient l'état TERMINAL « Dossier clôturé » (refusés / fin de vie /
--    scellé). Son CODE est conservé : aucune donnée ni référence déplacée.
-- Le code technique ARCHIVAGE reste l'état terminal ; on ne fait qu'insérer une
-- étape et renuméroter. Les manuscrits référencent les statuts par ID, pas par ordre.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "workflow_statuses" WHERE "code" = 'CLOTURE_PRODUCTION') THEN
    -- Décale les étapes 15..21 d'un cran pour libérer la place après l'Impression (14).
    UPDATE "workflow_statuses" SET "step_order" = "step_order" + 1 WHERE "step_order" >= 15;
    INSERT INTO "workflow_statuses" ("id", "code", "label", "step_order", "department_id", "is_conditional")
      SELECT gen_random_uuid(), 'CLOTURE_PRODUCTION', 'Clôture de production', 15,
             (SELECT "id" FROM "departments" WHERE "code" = 'ARCH'), false;
  END IF;
  -- Renomme l'état terminal (idempotent).
  UPDATE "workflow_statuses" SET "label" = 'Dossier clôturé' WHERE "code" = 'ARCHIVAGE';
END $$;
