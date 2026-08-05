-- Délais cibles (SLA) par étape du workflow éditorial, stockés en paramètre
-- clé/valeur (JSON { code_étape → jours }) — paramétrables sans redéploiement
-- et prêts pour l'écran d'administration du workflow. Valeurs de départ
-- indicatives ; les étapes continues (vente, suivi, archivage) n'ont pas de délai.
-- Idempotent : ne réécrit pas un paramètre déjà présent.
INSERT INTO "settings" ("id", "key", "value", "version", "updated_at")
VALUES (
  gen_random_uuid()::text,
  'workflow.step_target_days',
  '{"RECEPTION":2,"VERIF_ADMIN":3,"COMITE_LECTURE":30,"DECISION_EDITORIALE":10,"CONTRACTUALISATION":15,"PLANIFICATION":7,"CORRECTION":45,"EXPERTISE":30,"REECRITURE":30,"MISE_EN_PAGE":20,"INFOGRAPHIE":15,"ATTRIBUTION_REFERENCES":5,"VALIDATION_BAT":7,"IMPRESSION":30,"CONTROLE_QUALITE_IMPRESSION":5,"ENTREE_STOCK":3,"COMMERCIALISATION":7}'::jsonb,
  1,
  now()
)
ON CONFLICT ("key") DO NOTHING;
