-- Per-referrer chat outreach log so staff can see "already messaged on WhatsApp/Telegram/Viber"
-- and avoid double-messaging. Mirrors ambassador_applications.outreach_log.
ALTER TABLE "referrers" ADD COLUMN "outreach_log" JSONB;
