-- Anomalies de correction issues des relectures IA : validation humaine tracée
-- ligne par ligne (accepter / modifier / rejeter / à vérifier). Lot 3.
CREATE TABLE "correction_anomalies" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL DEFAULT 0,
    "severity" TEXT NOT NULL DEFAULT 'C3',
    "face" TEXT,
    "location" TEXT,
    "element" TEXT,
    "observation" TEXT,
    "proposal" TEXT,
    "justification" TEXT,
    "status" TEXT NOT NULL DEFAULT 'a_traiter',
    "resolution_note" TEXT,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "correction_anomalies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "correction_anomalies_manuscript_id_idx" ON "correction_anomalies"("manuscript_id");
CREATE INDEX "correction_anomalies_job_id_idx" ON "correction_anomalies"("job_id");

ALTER TABLE "correction_anomalies" ADD CONSTRAINT "correction_anomalies_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai_reading_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
