-- i18n : langue d'interface par utilisateur. Additif, nullable via défaut.
ALTER TABLE "users" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'fr';
