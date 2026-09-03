-- Réseau de partenaires du pôle Marketing, Communication & Distribution.
CREATE TYPE "MarketingPartnerType" AS ENUM ('librairie', 'ecole', 'universite', 'bibliotheque', 'distributeur', 'grossiste', 'revendeur', 'association', 'institution', 'media', 'organisateur_evenement', 'autre');

CREATE TABLE "marketing_partners" (
    "id" TEXT NOT NULL,
    "type" "MarketingPartnerType" NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "country" TEXT,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "partnership_type" TEXT,
    "conditions" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "marketing_partners_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "marketing_partners_type_idx" ON "marketing_partners"("type");
