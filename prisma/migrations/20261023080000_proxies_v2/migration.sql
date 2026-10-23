-- Proxies v2: per-IP health, geo-verification and Proxy-Cheap billing fields.
ALTER TABLE "proxies"
  ADD COLUMN "provider_proxy_id" TEXT,
  ADD COLUMN "verified_country" TEXT,
  ADD COLUMN "geo_checked_at" TIMESTAMP(3),
  ADD COLUMN "auto_extend" BOOLEAN,
  ADD COLUMN "expires_at" TIMESTAMP(3),
  ADD COLUMN "health" TEXT,
  ADD COLUMN "last_checked_at" TIMESTAMP(3),
  ADD COLUMN "consecutive_fails" INTEGER NOT NULL DEFAULT 0;
