-- CreateTable
CREATE TABLE "manuscript_number_counters" (
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "manuscript_number_counters_pkey" PRIMARY KEY ("year")
);
