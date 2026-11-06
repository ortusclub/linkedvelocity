-- Per-renter toggle for showing the account's proxy in the Sign-in panel (default on).
ALTER TABLE "users" ADD COLUMN "show_proxy" BOOLEAN NOT NULL DEFAULT true;
