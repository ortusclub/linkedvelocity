-- Recovery helper step 2: track whether the owner link was sent/shared (admin side) and the
-- owner's self-reported outcome ("worked" / "stuck") from the /recover page buttons.
ALTER TABLE "linkedin_accounts" ADD COLUMN "recovery_sent_at" TIMESTAMP(3);
ALTER TABLE "linkedin_accounts" ADD COLUMN "recovery_sent_via" TEXT;
ALTER TABLE "linkedin_accounts" ADD COLUMN "recovery_outcome" TEXT;
ALTER TABLE "linkedin_accounts" ADD COLUMN "recovery_outcome_at" TIMESTAMP(3);
