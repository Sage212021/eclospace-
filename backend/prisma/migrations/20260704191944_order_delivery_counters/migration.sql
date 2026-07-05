-- CreateTable
CREATE TABLE "sales_order_number_counters" (
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sales_order_number_counters_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "delivery_number_counters" (
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "delivery_number_counters_pkey" PRIMARY KEY ("year")
);

