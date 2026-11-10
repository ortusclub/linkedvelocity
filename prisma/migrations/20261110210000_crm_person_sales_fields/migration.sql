-- CRM v2 sales lens: additive fields on the unified crm_people overlay.
-- All nullable; no backfill, no data change to existing rows.
ALTER TABLE "crm_people"
  ADD COLUMN "next_step" TEXT,
  ADD COLUMN "interest" TEXT,
  ADD COLUMN "deal_value" INTEGER,
  ADD COLUMN "direction" TEXT;
