-- Numéro / personne à prévenir en cas d'urgence sur la fiche employé. Le
-- bulletin de paie prévoyait déjà de l'afficher (« Contact urgence ») mais
-- aucun champ ne permettait de le saisir : on l'ajoute et on connecte les deux.
ALTER TABLE "employees" ADD COLUMN "emergency_contact" TEXT;
