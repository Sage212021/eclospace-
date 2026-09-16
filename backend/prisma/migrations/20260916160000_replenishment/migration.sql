-- Cycle de réapprovisionnement (§9) : demande → validé → en cours →
-- (partiellement) reçu → clôturé / annulé. Le stock n'augmente qu'à la réception
-- (un StockMovement d'entrée est créé à ce moment-là).
CREATE TYPE "ReplenishmentStatus" AS ENUM ('requested', 'approved', 'in_progress', 'partially_received', 'received', 'cancelled');

CREATE TABLE "replenishments" (
  "id" TEXT NOT NULL,
  "isbn_id" TEXT NOT NULL,
  "location_id" TEXT NOT NULL,
  "quantity_requested" INTEGER NOT NULL,
  "quantity_received" INTEGER NOT NULL DEFAULT 0,
  "status" "ReplenishmentStatus" NOT NULL DEFAULT 'requested',
  "supplier" TEXT,
  "unit_cost" DECIMAL(10,2),
  "order_ref" TEXT,
  "receipt_ref" TEXT,
  "note" TEXT,
  "requested_by" TEXT,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validated_by" TEXT,
  "validated_at" TIMESTAMP(3),
  "received_at" TIMESTAMP(3),
  "cancelled_by" TEXT,
  "cancelled_at" TIMESTAMP(3),
  "cancel_reason" TEXT,
  CONSTRAINT "replenishments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "replenishments" ADD CONSTRAINT "replenishments_isbn_id_fkey" FOREIGN KEY ("isbn_id") REFERENCES "isbns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "replenishments" ADD CONSTRAINT "replenishments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "stock_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
