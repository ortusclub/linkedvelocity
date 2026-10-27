-- Distinguish a stalled maturing campaign from a healthy one. A profile can have a
-- campaign that isn't actually maturing — stuck on a login/identity review
-- (needs_review) or otherwise not sending. Those must show a ⚠️ "stalled" badge, not
-- the healthy 🔥. Set/cleared only by the reconcile-maturing cron; mutually exclusive
-- with maturing_started_at.
ALTER TABLE "linkedin_accounts" ADD COLUMN "maturing_stalled_at" TIMESTAMP(3);
ALTER TABLE "linkedin_accounts" ADD COLUMN "maturing_stalled_reason" TEXT;
