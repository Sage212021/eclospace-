-- CreateTable
CREATE TABLE "po_number_counters" (
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "po_number_counters_pkey" PRIMARY KEY ("year")
);

