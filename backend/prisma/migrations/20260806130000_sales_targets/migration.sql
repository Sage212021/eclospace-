-- Objectifs commerciaux annuels par commercial (CA cible).
CREATE TABLE "sales_targets" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "target_revenue" DECIMAL(14,2) NOT NULL,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_targets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sales_targets_user_id_year_key" ON "sales_targets"("user_id", "year");
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
