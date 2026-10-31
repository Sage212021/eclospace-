-- Veille des abonnements & paiements numériques (module administrateur).
CREATE TYPE "DigitalServiceKind" AS ENUM ('subscription_monthly', 'usage_based');
CREATE TYPE "DigitalPaymentStatus" AS ENUM ('confirmed', 'pending');

CREATE TABLE "digital_services" (
  "id"             TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "description"    TEXT,
  "kind"           "DigitalServiceKind" NOT NULL DEFAULT 'subscription_monthly',
  "billing_url"    TEXT,
  "billing_label"  TEXT,
  "currency"       TEXT NOT NULL DEFAULT 'FCFA',
  "next_due_date"  TIMESTAMP(3),
  "monthly_budget" DECIMAL(14,2),
  "current_usage"  DECIMAL(14,2),
  "usage_period"   TEXT,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "sort_order"     INTEGER NOT NULL DEFAULT 0,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"     TEXT,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  "updated_by"     TEXT,
  "deleted_at"     TIMESTAMP(3),
  "deleted_by"     TEXT,
  CONSTRAINT "digital_services_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "digital_services_key_key" ON "digital_services"("key");

CREATE TABLE "digital_service_payments" (
  "id"                  TEXT NOT NULL,
  "service_id"          TEXT NOT NULL,
  "amount"              DECIMAL(14,2) NOT NULL,
  "currency"            TEXT NOT NULL DEFAULT 'FCFA',
  "paid_at"             TIMESTAMP(3) NOT NULL,
  "reference"           TEXT,
  "method"              TEXT,
  "status"              "DigitalPaymentStatus" NOT NULL DEFAULT 'confirmed',
  "new_due_date"        TIMESTAMP(3),
  "receipt_document_id" TEXT,
  "note"                TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"          TEXT,
  "deleted_at"          TIMESTAMP(3),
  "deleted_by"          TEXT,
  CONSTRAINT "digital_service_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "digital_service_payments_service_id_idx" ON "digital_service_payments"("service_id");
ALTER TABLE "digital_service_payments" ADD CONSTRAINT "digital_service_payments_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "digital_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
