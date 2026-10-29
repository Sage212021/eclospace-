-- Mode « assistance à la réécriture » des observations du guide (Phase 2b).
ALTER TABLE "guide_observations" ADD COLUMN "rewrite_status" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "guide_observations" ADD COLUMN "rewrite_original" TEXT;
ALTER TABLE "guide_observations" ADD COLUMN "rewrite_problem" TEXT;
ALTER TABLE "guide_observations" ADD COLUMN "rewrite_proposal" TEXT;
ALTER TABLE "guide_observations" ADD COLUMN "rewrite_justification" TEXT;
ALTER TABLE "guide_observations" ADD COLUMN "rewrite_decided_by_id" TEXT;
ALTER TABLE "guide_observations" ADD COLUMN "rewrite_decided_at" TIMESTAMP(3);
