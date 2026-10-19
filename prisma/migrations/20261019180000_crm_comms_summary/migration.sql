-- Renters/CRM: cache an AI running summary of each lead's comms_log so the timeline
-- stays scannable instead of a long per-message dump. Additive + nullable; safe.
ALTER TABLE "inbound_leads"
  ADD COLUMN "comms_summary" TEXT,
  ADD COLUMN "comms_summary_at" TIMESTAMP(3);
