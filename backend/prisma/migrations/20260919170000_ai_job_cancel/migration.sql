-- Statut « annulé » pour un lancement IA arrêté par l'opérateur (bouton Stopper).
ALTER TYPE "AiJobStatus" ADD VALUE IF NOT EXISTS 'annule';
