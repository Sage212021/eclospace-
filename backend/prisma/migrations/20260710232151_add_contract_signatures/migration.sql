-- CreateEnum
CREATE TYPE "SignatureParty" AS ENUM ('author', 'publisher');

-- CreateTable
CREATE TABLE "contract_signatures" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "party" "SignatureParty" NOT NULL,
    "signer_name" TEXT NOT NULL,
    "recorded_by" TEXT NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terms_hash" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "contract_signatures_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
