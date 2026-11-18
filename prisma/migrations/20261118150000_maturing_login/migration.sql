-- LV Agent: login state on Profile Maturing (🔑 / ⚠️ icons on the Pipeline page).
ALTER TABLE "linkedin_accounts" ADD COLUMN "maturing_login" JSONB;
