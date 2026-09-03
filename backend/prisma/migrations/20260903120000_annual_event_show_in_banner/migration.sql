-- Case « Afficher dans le bandeau À venir » sur les événements de planning.
-- Coché par défaut ; se décoche pour les événements internes (voyages du DG…).
ALTER TABLE "annual_events" ADD COLUMN "show_in_banner" BOOLEAN NOT NULL DEFAULT true;
