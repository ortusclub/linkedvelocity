-- Owner-exit reason on the status strip: distinguishes a clean handback
-- ("returned") from the owner cutting off our access ("access_lost") while an
-- account sits off-market (status=unavailable). Null = other / legacy Withdrawn.
ALTER TABLE "linkedin_accounts" ADD COLUMN "exit_reason" TEXT;
