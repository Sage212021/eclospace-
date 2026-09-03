-- Texte source du rapport IA conservé pour pouvoir régénérer le .docx à la
-- demande, avec ou sans en-tête maison (choix d'impression côté utilisateur).
ALTER TABLE "ai_reading_jobs" ADD COLUMN "report_text" TEXT;
