-- Réponse à l'auteur à la décision éditoriale : trace de l'envoi de la lettre.
ALTER TABLE "editorial_decisions" ADD COLUMN "author_notified_at" TIMESTAMP(3);
ALTER TABLE "editorial_decisions" ADD COLUMN "author_notified_to" TEXT;
