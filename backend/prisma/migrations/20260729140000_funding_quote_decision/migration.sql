-- CreateEnum
CREATE TYPE "FundingMode" AS ENUM ('publisher', 'author');
CREATE TYPE "QuoteDecision" AS ENUM ('pending', 'requested', 'deferred', 'skipped');

-- AlterTable
ALTER TABLE "manuscripts"
  ADD COLUMN "funding_mode" "FundingMode" NOT NULL DEFAULT 'publisher',
  ADD COLUMN "quote_decision" "QuoteDecision" NOT NULL DEFAULT 'pending',
  ADD COLUMN "quote_decision_note" TEXT,
  ADD COLUMN "quote_decision_at" TIMESTAMP(3),
  ADD COLUMN "quote_decision_by" TEXT;
