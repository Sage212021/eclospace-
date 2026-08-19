-- NIU (identifiant fiscal) de l'employé, saisi sur la fiche RH et repris sur le
-- bulletin de paie (le bulletin le préfère, avec repli sur le profil de paie).
ALTER TABLE "employees" ADD COLUMN "niu" TEXT;
