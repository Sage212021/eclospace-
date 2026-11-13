-- D-055 (13/11/2026) : réaménagement du circuit de production — l'« Attribution
-- des références » (ISBN) est remontée JUSTE APRÈS la « Mise en page » et AVANT
-- l'« Infographie », afin que l'ISBN (et le code-barres EAN-13, disponible dès
-- qu'un ISBN existe) soit prêt quand l'infographe conçoit la couverture.
--
-- Nouvel ordre : Mise en page (9) -> Attribution des références (10) ->
-- Infographie (11) -> Validation du BAT (12). Les autres étapes sont inchangées.
--
-- Échange des deux numéros d'ordre, repéré par CODE (indépendant des valeurs en
-- place, donc rejouable sans risque). step_order n'a pas de contrainte d'unicité
-- (seul `code` est unique) : aucune collision possible pendant l'échange.
-- Aucune donnée d'ouvrage n'est modifiée : seules les DÉFINITIONS d'étapes sont
-- renumérotées (les ouvrages conservent leur statut et tout leur historique).
UPDATE "workflow_statuses" SET "step_order" = 10 WHERE "code" = 'ATTRIBUTION_REFERENCES';
UPDATE "workflow_statuses" SET "step_order" = 11 WHERE "code" = 'INFOGRAPHIE';
