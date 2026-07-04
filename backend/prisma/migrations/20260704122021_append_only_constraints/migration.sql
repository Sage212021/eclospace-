-- Contraintes d'intégrité non négociables (Modèle de données §13) :
-- appliquées en base, pas seulement côté applicatif, pour qu'aucun rôle,
-- pas même l'administrateur, ne puisse les contourner par erreur.

-- 1. audit_log est append-only : ni UPDATE ni DELETE, jamais.
CREATE OR REPLACE FUNCTION forbid_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log est append-only : % interdit sur la ligne %', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_log_mutation();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_log_mutation();

-- 2. document_versions : aucune version n'est jamais supprimée, et les
-- champs qui identifient le fichier figé (contenu, hash, numéro de version)
-- ne sont jamais réécrits une fois la version créée. Le statut (draft →
-- in_review → validated → archived) reste modifiable.
CREATE OR REPLACE FUNCTION forbid_document_version_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'document_versions : suppression interdite (version %)', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_versions_no_delete
  BEFORE DELETE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_document_version_delete();

CREATE OR REPLACE FUNCTION forbid_document_version_content_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.document_id     <> OLD.document_id
     OR NEW.version_number <> OLD.version_number
     OR NEW.file_path       <> OLD.file_path
     OR NEW.file_size       <> OLD.file_size
     OR NEW.mime_type       <> OLD.mime_type
     OR NEW.sha256_hash     <> OLD.sha256_hash
  THEN
    RAISE EXCEPTION 'document_versions : le fichier figé de la version % est immuable (seul le statut peut changer)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_versions_no_content_update
  BEFORE UPDATE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_document_version_content_mutation();
