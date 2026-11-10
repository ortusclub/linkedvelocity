-- Manual operator flag from the maturing tracker (see schema comment).
ALTER TABLE "linkedin_accounts" ADD COLUMN "maturing_flag" JSONB;
