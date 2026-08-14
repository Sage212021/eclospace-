-- Journal d'envoi des contrats (demande opérateur du 14/08/2026) : trace chaque
-- transmission du contrat à l'auteur (messagerie interne ou WhatsApp). Table +
-- enum additifs uniquement, aucun impact sur l'existant.

-- CreateEnum
CREATE TYPE "ContractDispatchChannel" AS ENUM ('messagerie_interne', 'whatsapp');

-- CreateTable
CREATE TABLE "contract_dispatches" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "channel" "ContractDispatchChannel" NOT NULL,
    "document_label" TEXT NOT NULL DEFAULT '',
    "recipient" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_dispatches_contract_id_idx" ON "contract_dispatches"("contract_id");

-- AddForeignKey
ALTER TABLE "contract_dispatches" ADD CONSTRAINT "contract_dispatches_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
