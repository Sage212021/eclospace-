-- Cycle de vie de la lettre de décision éditoriale : générer ≠ valider ≠ envoyer.
-- Aperçu → validation explicite → envoi manuel → accusé de réception par l'auteur
-- (via un lien sécurisé par jeton). La version envoyée est figée et conservée.
CREATE TYPE "DecisionLetterStatus" AS ENUM ('brouillon', 'a_valider', 'validee', 'envoyee');

CREATE TABLE "decision_letters" (
    "id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "letter_key" TEXT NOT NULL,
    "status" "DecisionLetterStatus" NOT NULL DEFAULT 'a_valider',
    "version" INTEGER NOT NULL DEFAULT 1,
    "subject" TEXT NOT NULL DEFAULT '',
    "text_body" TEXT NOT NULL DEFAULT '',
    "recipient_email" TEXT,
    "generated_by" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validated_by" TEXT,
    "validated_at" TIMESTAMP(3),
    "sent_by" TEXT,
    "sent_at" TIMESTAMP(3),
    "confirm_token" TEXT,
    "opened_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "delivery_failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "decision_letters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "decision_letters_decision_id_key" ON "decision_letters"("decision_id");
CREATE UNIQUE INDEX "decision_letters_confirm_token_key" ON "decision_letters"("confirm_token");
CREATE INDEX "decision_letters_manuscript_id_idx" ON "decision_letters"("manuscript_id");

ALTER TABLE "decision_letters" ADD CONSTRAINT "decision_letters_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "editorial_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
