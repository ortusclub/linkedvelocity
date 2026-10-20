-- Recovery-helper QR relay: a screenshot of LinkedIn's in-app verification QR the team
-- captures from the GoLogin session and relays to the owner via the /recover owner link.
ALTER TABLE "linkedin_accounts" ADD COLUMN "recovery_qr_url" TEXT;
ALTER TABLE "linkedin_accounts" ADD COLUMN "recovery_qr_at" TIMESTAMP(3);
