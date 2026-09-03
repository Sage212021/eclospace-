-- Campagnes marketing (pôle Marketing, Communication & Distribution).
CREATE TYPE "MarketingCampaignStatus" AS ENUM ('planifiee', 'en_cours', 'terminee', 'annulee');

CREATE TABLE "marketing_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "manuscript_id" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "budget_prevu" DECIMAL(12,2),
    "budget_engage" DECIMAL(12,2),
    "statut" "MarketingCampaignStatus" NOT NULL DEFAULT 'planifiee',
    "resultats" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "marketing_campaigns_statut_idx" ON "marketing_campaigns"("statut");
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_manuscript_id_fkey" FOREIGN KEY ("manuscript_id") REFERENCES "manuscripts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
