-- Barème des avantages en nature (CGI art. 33) ajouté au barème versionné.
-- Défauts légaux : logement 15 %, électricité 4 %, eau 2 %, domestique 5 %,
-- véhicule 10 %, nourriture 10 % (fractions).
ALTER TABLE "payroll_rate_sets" ADD COLUMN "an_logement_pct" DECIMAL(6,4) NOT NULL DEFAULT 0.15;
ALTER TABLE "payroll_rate_sets" ADD COLUMN "an_electricite_pct" DECIMAL(6,4) NOT NULL DEFAULT 0.04;
ALTER TABLE "payroll_rate_sets" ADD COLUMN "an_eau_pct" DECIMAL(6,4) NOT NULL DEFAULT 0.02;
ALTER TABLE "payroll_rate_sets" ADD COLUMN "an_domestique_pct" DECIMAL(6,4) NOT NULL DEFAULT 0.05;
ALTER TABLE "payroll_rate_sets" ADD COLUMN "an_vehicule_pct" DECIMAL(6,4) NOT NULL DEFAULT 0.10;
ALTER TABLE "payroll_rate_sets" ADD COLUMN "an_nourriture_pct" DECIMAL(6,4) NOT NULL DEFAULT 0.10;

-- Catalogue des éléments de salaire et leur traitement fiscal/CNPS.
CREATE TABLE "salary_elements" (
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "fiscal_status" TEXT NOT NULL,
  "cnps_status" TEXT NOT NULL,
  "legal_ref" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" TEXT,
  CONSTRAINT "salary_elements_pkey" PRIMARY KEY ("code")
);
