-- Proxy reveal is opt-in: default OFF, and turn existing renters OFF so the team enables it
-- per renter (the previous migration backfilled everyone to true).
ALTER TABLE "users" ALTER COLUMN "show_proxy" SET DEFAULT false;
UPDATE "users" SET "show_proxy" = false;
