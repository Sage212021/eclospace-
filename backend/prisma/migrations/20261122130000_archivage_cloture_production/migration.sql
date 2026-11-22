-- Renommage du LIBELLÉ de l'étape de workflow « Archivage » → « Clôture de production »
-- (D-076). Le CODE technique reste ARCHIVAGE (aucune donnée ni référence déplacée) :
-- on ne change que le texte affiché. Garantit la mise à jour en production même si
-- le seed venait à expirer.
UPDATE "workflow_statuses" SET "label" = 'Clôture de production' WHERE "code" = 'ARCHIVAGE';
