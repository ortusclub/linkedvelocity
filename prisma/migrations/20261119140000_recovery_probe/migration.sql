-- LV Agent: automated recovery recheck for RESTRICTED accounts (profile-load probe).
-- The agent loads a restricted account's own linkedinUrl from a healthy LV session and reports
-- { loaded, at, from? }. loaded=true surfaces a "profile loads — verify" flag on Restrictions v2;
-- it NEVER auto-clears restrictedAt (a human confirms and recovers).
ALTER TABLE "linkedin_accounts" ADD COLUMN "recovery_probe" JSONB;
