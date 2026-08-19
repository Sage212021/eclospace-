-- « Supprimer la discussion » : marqueur par utilisateur pour effacer une
-- conversation de son côté (elle réapparaît dès qu'un message plus récent
-- arrive). L'option « supprimer pour tout le monde » réutilise ce marqueur pour
-- les deux participants et supprime logiquement les messages.
ALTER TABLE "conversation_reads" ADD COLUMN "cleared_at" TIMESTAMP(3);
