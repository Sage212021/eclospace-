-- Coordonnées WhatsApp de la contrepartie (auteur / prestataire), pour lui
-- adresser les notifications de suivi (demande opérateur du 02/08/2026).
ALTER TABLE "partners" ADD COLUMN "whatsapp" TEXT;

-- Nature d'un document rattaché à un contrat.
CREATE TYPE "ContractDocumentKind" AS ENUM ('signed_scan', 'annexe');

-- Pièces numérisées d'un contrat : contrat physique signé scanné (PDF/images)
-- et annexes. Le fichier vit hors base (GED) ; seule sa référence est stockée.
-- Suppression logique uniquement (conformité modèle §13).
CREATE TABLE "contract_documents" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "kind" "ContractDocumentKind" NOT NULL DEFAULT 'signed_scan',
    "label" TEXT NOT NULL DEFAULT '',
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_mime" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    CONSTRAINT "contract_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contract_documents_contract_id_idx" ON "contract_documents"("contract_id");

ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
