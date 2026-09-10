-- « Quoi de neuf » : le canal de diffusion est passé de la cloche à la MESSAGERIE
-- interne (expéditeur « Eclospace »). Les notes déjà marquées « diffusées » par
-- l'ancien canal ne seraient jamais renvoyées par le nouveau. On les RÉ-ARME une
-- seule fois (dispatched_at = NULL) : au prochain déploiement, le seed les
-- (re)diffusera comme messages d'« Eclospace ». Sans effet sur une base vierge
-- (les notes n'y existent pas encore au moment de cette migration).
UPDATE "release_notes" SET "dispatched_at" = NULL;
