-- Veille des échéances éditoriales : alertes émises (anti-doublon).
CREATE TABLE "editorial_deadline_alerts" (
  "id"            TEXT NOT NULL,
  "task_id"       TEXT NOT NULL,
  "manuscript_id" TEXT NOT NULL,
  "kind"          TEXT NOT NULL,
  "threshold"     TEXT NOT NULL,
  "dedupe_key"    TEXT NOT NULL,
  "sent_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "editorial_deadline_alerts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "editorial_deadline_alerts_dedupe_key_key" ON "editorial_deadline_alerts"("dedupe_key");
CREATE INDEX "editorial_deadline_alerts_task_id_idx" ON "editorial_deadline_alerts"("task_id");
