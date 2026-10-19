-- AUTO maturing indicator: set while a live LinkedVelocity maturing campaign
-- is running for the account's GoLogin profile; null = not maturing. Managed
-- only by the reconcile-maturing cron, orthogonal to warmup_started_at.
ALTER TABLE "linkedin_accounts" ADD COLUMN "maturing_started_at" TIMESTAMP(3);
