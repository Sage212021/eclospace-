-- Lot 3 — 2ᵉ temps « intégration » des anomalies de correction.
-- L'intégrateur applique la correction retenue et coche l'état, distinct de la
-- décision du correcteur. Ne concerne que les anomalies acceptées/modifiées.
ALTER TABLE "correction_anomalies"
  ADD COLUMN "integration_status" TEXT NOT NULL DEFAULT 'a_integrer',
  ADD COLUMN "integrated_by_id" TEXT,
  ADD COLUMN "integrated_at" TIMESTAMP(3),
  ADD COLUMN "integration_note" TEXT;
