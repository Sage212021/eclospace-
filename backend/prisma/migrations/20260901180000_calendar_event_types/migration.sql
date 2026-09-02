-- Nouveaux types d'événements du calendrier (vie éditoriale publique) :
-- dédicace, salon du livre, lancement d'ouvrage. Ajouts idempotents.
ALTER TYPE "CalendarEventType" ADD VALUE IF NOT EXISTS 'dedicace';
ALTER TYPE "CalendarEventType" ADD VALUE IF NOT EXISTS 'salon';
ALTER TYPE "CalendarEventType" ADD VALUE IF NOT EXISTS 'lancement';
