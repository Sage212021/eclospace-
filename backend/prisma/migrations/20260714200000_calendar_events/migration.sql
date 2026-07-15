-- Centre de Communication Interne — Calendrier partagé & événements.
-- Extension additive : nouvelles tables et type uniquement.

-- CreateEnum
CREATE TYPE "CalendarEventType" AS ENUM ('reunion', 'echeance', 'formation', 'sortie', 'ceremonie', 'autre');

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "CalendarEventType" NOT NULL DEFAULT 'autre',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "author_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event_targets" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "target_type" "AnnouncementTargetType" NOT NULL,
    "target_id" TEXT,

    CONSTRAINT "calendar_event_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_events_starts_at_idx" ON "calendar_events"("starts_at");

-- CreateIndex
CREATE INDEX "calendar_event_targets_event_id_idx" ON "calendar_event_targets"("event_id");

-- CreateIndex
CREATE INDEX "calendar_event_targets_target_type_target_id_idx" ON "calendar_event_targets"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_targets" ADD CONSTRAINT "calendar_event_targets_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
