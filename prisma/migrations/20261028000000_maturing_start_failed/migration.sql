-- Track a failed auto-start so the cron can SKIP the account for a cooldown instead of
-- re-attempting the same failing candidates every tick (which clogged the 5 start slots
-- and starved the startable accounts). Set when start() throws (engine couldn't launch
-- a campaign — e.g. the profile can't log in); cleared on a successful start or when the
-- account is rented/restricted. Also surfaces the account in the ⚠️ attention list.
ALTER TABLE "linkedin_accounts" ADD COLUMN "maturing_start_failed_at" TIMESTAMP(3);
ALTER TABLE "linkedin_accounts" ADD COLUMN "maturing_start_failed_reason" TEXT;
