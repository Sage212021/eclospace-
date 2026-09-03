-- Pôle Marketing, Communication & Distribution (D-031) — Fiche marketing par ouvrage.
CREATE TYPE "MarketingCanal" AS ENUM ('reseaux_sociaux', 'presse', 'newsletter', 'lancement', 'dedicace', 'salon', 'partenariat', 'influenceur', 'institutionnel', 'vente_directe', 'autre');
CREATE TYPE "MarketingActionStatus" AS ENUM ('a_faire', 'en_cours', 'fait', 'annule');
CREATE TYPE "MarketingPriorite" AS ENUM ('basse', 'normale', 'haute');

CREATE TABLE "marketing_plans" (
    "id" TEXT NOT NULL,
    "manuscript_id" TEXT NOT NULL,
    "public_cible" TEXT,
    "public_secondaire" TEXT,
    "zone_geo" TEXT,
    "besoin" TEXT,
    "argumentaire" TEXT,
    "arguments_vente" TEXT,
    "positionnement" TEXT,
    "responsable_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "marketing_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "marketing_plans_manuscript_id_key" ON "marketing_plans"("manuscript_id");
ALTER TABLE "marketing_plans" ADD CONSTRAINT "marketing_plans_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "marketing_actions" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "canal" "MarketingCanal" NOT NULL,
    "action" TEXT NOT NULL,
    "responsable" TEXT,
    "date_debut" TIMESTAMP(3),
    "echeance" TIMESTAMP(3),
    "budget_prevu" DECIMAL(12,2),
    "budget_engage" DECIMAL(12,2),
    "statut" "MarketingActionStatus" NOT NULL DEFAULT 'a_faire',
    "priorite" "MarketingPriorite" NOT NULL DEFAULT 'normale',
    "lien" TEXT,
    "resultat" TEXT,
    "commentaire" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "marketing_actions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "marketing_actions_plan_id_idx" ON "marketing_actions"("plan_id");
ALTER TABLE "marketing_actions" ADD CONSTRAINT "marketing_actions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "marketing_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
