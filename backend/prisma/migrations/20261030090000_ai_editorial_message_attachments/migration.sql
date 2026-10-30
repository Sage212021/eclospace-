-- Pièce jointe (PDF/.docx/texte/image) au dialogue éditorial SAGE par ouvrage.
ALTER TABLE "ai_editorial_messages" ADD COLUMN "attachments" JSONB;
