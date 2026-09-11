-- Garde-fou « aperçu téléchargé » à l'étape PLANIFICATION : on trace la dernière
-- génération de l'aperçu/PDF officiel du planning pour bloquer le passage à
-- l'étape suivante tant que le document n'a pas été produit au moins une fois.
ALTER TABLE "project_plans" ADD COLUMN "pdf_generated_at" TIMESTAMP(3);
ALTER TABLE "project_plans" ADD COLUMN "pdf_generated_by" TEXT;
