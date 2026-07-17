-- CreateTable
CREATE TABLE "payroll_closure_reminders" (
    "id" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "reminder_day" INTEGER NOT NULL,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_by" TEXT,

    CONSTRAINT "payroll_closure_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_closure_reminders_period_key_idx" ON "payroll_closure_reminders"("period_key");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_closure_reminders_period_key_reminder_day_key" ON "payroll_closure_reminders"("period_key", "reminder_day");
