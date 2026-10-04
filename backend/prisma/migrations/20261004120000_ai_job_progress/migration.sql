-- Avancement d'un lancement de relecture IA (phase + tranches faites/total +
-- battement) : affiché à l'écran et utilisé comme heartbeat par le balayage des
-- lancements restés « en cours ».
ALTER TABLE "ai_reading_jobs" ADD COLUMN "progress_label" TEXT;
ALTER TABLE "ai_reading_jobs" ADD COLUMN "progress_done" INTEGER;
ALTER TABLE "ai_reading_jobs" ADD COLUMN "progress_total" INTEGER;
ALTER TABLE "ai_reading_jobs" ADD COLUMN "progress_at" TIMESTAMP(3);
