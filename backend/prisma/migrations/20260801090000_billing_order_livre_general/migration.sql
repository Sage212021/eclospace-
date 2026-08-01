-- Nouvelle catégorie de commande à facturer : « livre général / simple »
-- (catalogue des ouvrages généraux, sélectionnables comme le livre scolaire).
-- PostgreSQL ≥ 12 autorise ADD VALUE dans une transaction.
ALTER TYPE "BillingOrderCategory" ADD VALUE IF NOT EXISTS 'livre_general';
