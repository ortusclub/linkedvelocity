-- Owner contact captured when a referrer hides a PAID signup from their portal.
-- Nullable, additive; no backfill and no change to existing rows.
ALTER TABLE "ambassador_applications" ADD COLUMN "owner_contact" JSONB;
