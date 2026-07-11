-- Modes de paiement configurables + référence de transaction + devise XAF.
-- Conversion en place (aucune donnée perdue).

-- CreateEnum
CREATE TYPE "PaymentMethodKind" AS ENUM ('especes', 'virement', 'cheque', 'carte', 'mobile_money', 'autre');

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "PaymentMethodKind" NOT NULL DEFAULT 'autre',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "default_account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_methods_code_key" ON "payment_methods"("code");
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_default_account_id_fkey" FOREIGN KEY ("default_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Devise par défaut XAF (F CFA Cameroun) + reprise des lignes existantes en XOF.
ALTER TABLE "bank_accounts" ALTER COLUMN "currency" SET DEFAULT 'XAF';
ALTER TABLE "invoices" ALTER COLUMN "currency" SET DEFAULT 'XAF';
ALTER TABLE "purchase_orders" ALTER COLUMN "currency" SET DEFAULT 'XAF';
UPDATE "bank_accounts" SET "currency" = 'XAF' WHERE "currency" = 'XOF';
UPDATE "invoices" SET "currency" = 'XAF' WHERE "currency" = 'XOF';
UPDATE "purchase_orders" SET "currency" = 'XAF' WHERE "currency" = 'XOF';

-- Paiements : référence de transaction + conversion du mode (enum -> texte/code).
ALTER TABLE "payments" ADD COLUMN "reference" TEXT;
ALTER TABLE "payments" ALTER COLUMN "method" TYPE TEXT USING "method"::text;

-- Suppression de l'ancien enum (le mode est désormais un code texte).
DROP TYPE "PaymentMethod";

-- Modes historiques (codes stables) ajoutés à la liste configurable.
INSERT INTO "payment_methods" ("id","code","label","kind","active","sort_order","updated_at") VALUES
 (gen_random_uuid()::text,'cash','Espèces','especes',true,10,now()),
 (gen_random_uuid()::text,'transfer','Virement bancaire','virement',true,20,now()),
 (gen_random_uuid()::text,'cheque','Chèque','cheque',true,30,now()),
 (gen_random_uuid()::text,'card','Carte bancaire','carte',true,40,now()),
 (gen_random_uuid()::text,'mobile_money','Mobile Money','mobile_money',true,50,now())
ON CONFLICT (code) DO NOTHING;
