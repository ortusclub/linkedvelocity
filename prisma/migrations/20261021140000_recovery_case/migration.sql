-- Restrictions v2 case tracker: the open restriction case's reason + manually-logged recovery
-- steps (ID verification / appeal form / LinkedIn decision / note). Email + QR steps are derived
-- from the existing recovery_* columns. Cleared on recover (archived into restriction_log).
ALTER TABLE "linkedin_accounts" ADD COLUMN "recovery_case" JSONB;
