-- Veille des abonnements : alertes émises (anti-doublon).
CREATE TABLE "digital_service_alerts" (
  "id"         TEXT NOT NULL,
  "service_id" TEXT NOT NULL,
  "kind"       TEXT NOT NULL,
  "threshold"  TEXT NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "sent_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "digital_service_alerts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "digital_service_alerts_dedupe_key_key" ON "digital_service_alerts"("dedupe_key");
CREATE INDEX "digital_service_alerts_service_id_idx" ON "digital_service_alerts"("service_id");
ALTER TABLE "digital_service_alerts" ADD CONSTRAINT "digital_service_alerts_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "digital_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
